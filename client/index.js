import io from 'socket.io-client';
import { MESSAGE_TYPE, PLATFORM, ROOM_SETTINGS } from '../enums'; // eslint-disable-line no-unused-vars
import SERVERS from '../servers';

function fetchTimeout(address, timeout) {
  // eslint-disable-next-line promise/avoid-new
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.timeout = timeout;
    xhr.onload = resolve;
    xhr.ontimeout = reject;
    xhr.open('GET', address, true);
  });
}

/**
 * Make a ping to server and return latency.
 *
 * @param {any} serverAddress - Ping address of server. Should return 2** status code.
 * @returns {number} Response latency
 */
async function CalculateLatency(serverAddress) {
  // Store current time to calculate latency later
  const startTime = Date.now();
  try {
    // Try to send a request to server with a timeout of 5s
    await fetchTimeout(serverAddress, 5000);
  } catch (err) {
    // If server is unavailable return Inf latency,
    // so we can be sure that it won't be used as closest
    return Infinity;
  }
  // Latency is (now - start).
  return Date.now() - startTime;
}

/**
 * Preforms pings to all servers from 'servers.js' and selects one with lowest latency.
 *
 * @returns {number} Index of closest server.
 */
async function FindClosestServer() {
  // Execute CalculateLatency function for each server.
  const serverPings = await Promise.all(Object.entries(SERVERS).map((info) => {
    const addresses = info[1];
    // Second element of addresses is ping url
    const latency = CalculateLatency(addresses[1]);
    return [info[0], latency];
  }));
  // Compare pings of all servers and return index of server with lowest latency.
  // ([0][0] is index of first sorting result)
  const closest = serverPings.sort(([latency1], [latency2]) => latency1 - latency2)[0][0];
  return closest;
}

/**
 * This class contains all functions, that fonsole provides for game development
 *
 * @class NetworkingAPI
 */
class NetworkingAPI {
  /**
   * Creates an instance of NetworkingAPI.
   *
   * @memberof NetworkingAPI
   */
  constructor() {
    // Load defaults
    this.clientConnections = {};
    this.events = {};
    this.gameEvents = {};
    this.connectionId = -1;
  }

  /**
   * Set's current room's game.
   * Can be called only by desktop.
   *
   * @param {string} game
   * @memberof NetworkingAPI
   */
  setGame(game) {
    if (!game || typeof game !== 'string') throw new Error('Invalid game name');

    // Game can be updated only in room
    if (!this.isInRoom) return;

    // Only desktop can update current game. Server has same check.
    if (this.platform === PLATFORM.DESKTOP) {
      // Send event to server, so it can notify all connections about it.
      this.socket.emit('game:set', game);
    }
  }

  /**
   * Returns a platform, where this api is executed, based on client id,
   * because desktop clients are always hosts
   *
   * @returns {?PLATFORM} Current platform. Can be null, if socket is not connected yet.
   * @readonly
   * @memberof NetworkingAPI
   */
  get platform() {
    if (this.connectionId === -1) return null; // Connection to socket is not established.
    // Desktop always has id 0
    return this.connectionId === 0 ?
      PLATFORM.DESKTOP :
      PLATFORM.CONTROLLER;
  }

  /**
   * Returns if player has joined any room
   *
   * @returns {Boolean} If player has joined any room
   * @memberof NetworkingAPI
   */
  get isInRoom() {
    return this.connectionId !== -1;
  }

  /**
   * Creates socket.io connection and subscribes to it's messages.
   *
   * @param {!number} server - Server Index.
   *                           All valid server indexes can be found in 'servers.js' file
   * @memberof NetworkingAPI
   */
  openSocket(serverIndex) {
    // Store server index, so we can generate room name
    this.serverIndex = serverIndex;
    if (!SERVERS[serverIndex] || !SERVERS[serverIndex][0]) throw new Error(`serverIndex (${serverIndex}) is not valid server index.`);
    const socketUrl = SERVERS[serverIndex][0];
    // Create socket.io
    this.socket = io(socketUrl);

    // This event fires when client joins / leaves room
    this.socket.on('room:status', (status = {}) => {
      if (status.roomName != null && status.connectionId != null) {
        // Joined, save room status
        this.roomName = status.roomName;
        this.connectionId = status.connectionId;
        if (status.connections) {
          Object.assign(this.clientConnections, status.connections);
        }
      } else {
        // Left, clear room status
        this.roomName = '';
        this.connectionId = -1;
        this.clientConnections = {};
        this.closeSocket();
      }

      this.emit('room:status', status);
    });

    // New client joined same room
    this.socket.on('connections:join', (connectionId, session) => {
      // Store session
      this.clientConnections[connectionId] = session;
      // Emit event, so game's can handle it
      this.emit('connections:join', connectionId, session);
    });

    // Client has just disconnected from room
    this.socket.on('connections:disconnect', (connectionId) => {
      // Remove reference
      this.clientConnections[connectionId] = undefined;
      // Emit event, so game's can handle it
      this.emit('connections:disconnect', connectionId);
    });

    // Desktop has changed game
    this.socket.on('game:set', (game) => {
      // Store current game name
      this.game = game;
      // Remove events subscribed in previous game
      this.gameEvents = {};
      // Emit this event locally, so platform can handle this change
      this.emit('game:set', game);
    });

    // Redirect all game events to listeners
    this.socket.on('game:event', ({ sender, event, args }) => {
      this.gameEmit(event, sender, args);
    });

    // Map message event, so platform can define it itself
    this.socket.on('system:msgbox', message => this.emit('system:msgbox', message));
  }

  /**
   * Closes socket.io connection if we got some.
   *
   * @memberof NetworkingAPI
   */
  closeSocket() {
    // Clear server id, because socket is based on it
    this.serverIndex = undefined;
    // Make sure that we have opened socket and close it.
    if (this.socket) this.socket.disconnect();
    this.socket = undefined;
  }

  /**
   * Makes client to open specific room and become it's host
   *
   * @param {?string} password Optional room password
   * @returns {Promise} A promise that will be resolved when client successfully joins room
   * A resolved object contains { roomName, connectionId } properties
   * @memberof NetworkingAPI
   */
  async openRoom(password) {
    // Try to find closest server
    const closestServerIndex = await FindClosestServer();
    this.openSocket(closestServerIndex);
    // Send command to socket.io server
    this.socket.emit('room:open', password);
    // Returning promise, that will be resolved once client opens room or received open error
    // eslint-disable-next-line promise/avoid-new
    return new Promise((resolve, reject) => {
      this.once('room:status', (status) => {
        // If we received client id and room then we actually joined room
        if (status.connectionId != null && status.roomName != null) {
          resolve({
            connectionId: status.connectionId,
            roomName: status.roomName,
          });
        } else { // Otherwise there should be some error
          reject(status.error || '');
        }
      });
    });
  }

  /**
   * Makes client to join specific room.
   *
   * @param {String} roomName Specified room name. First letter will be used as server index.
   * @param {?String} password Optional room password
   * @returns {Promise} A promise that will be resolved when client successfully joins room
   * A resolved object contains { roomName, connectionId, connections } properties
   * @memberof NetworkingAPI
   */
  joinRoom(roomName, password) {
    // Open connection to socket.io server, based on first room name letter
    this.openSocket(+roomName.charAt(0));
    // Real room name is a room name used on server.
    const realRoomName = roomName.substr(1);
    // Send command to socket.io server
    this.socket.emit('room:join', realRoomName, password);
    // Returning promise, that will be resolved once client joins room or received join error
    // eslint-disable-next-line promise/avoid-new
    return new Promise((resolve, reject) => {
      this.once('room:status', (status) => {
        // If we received client id and room then we actually joined room
        if (status.connectionId != null && status.roomName != null) {
          resolve(status);
        } else { // Otherwise there should be some error
          reject(status.error || '');
        }
      });
    });
  }

  /**
   * Makes client to leave current room
   *
   * @returns {void}
   * @memberof NetworkingAPI
   */
  leaveRoom() {
    // Leave only if we are already in some room
    if (this.isInRoom) {
      this.socket.emit('room:leave');
    }
  }

  /**
   * Emits general client event
   *
   * @param {String} event Emitted event name
   * @memberof NetworkingAPI
   */
  emit(event, ...content) {
    // If event has at least one listener
    if (this.events[event]) {
      // Iterate over all of them
      for (let i = 0; i < this.events[event].length; i += 1) {
        // If handler wasn't removed
        if (this.events[event][i]) {
          // Call each subscribed listener
          this.events[event][i].call(this, ...content);
        }
      }
    }
  }

  /**
   * Subscribe to general client events.
   *
   * @param {string} event Subscribed event name
   * @param {function} handler Callback function
   * @returns {Number} Listener index in event array
   * @memberof NetworkingAPI
   */
  on(event, handler) {
    // Make sure that we have array for our event
    if (!this.events[event]) this.events[event] = [];
    // Push callback to listeners list and return index
    return this.events[event].push(handler) - 1;
  }

  /**
   * Subscribe to next fired event
   *
   * @param {string} event Subscribed event name
   * @param {function} handler Callback function
   * @returns {Number} Listener index in event array
   * @memberof NetworkingAPI
   */
  once(event, handler) {
    // Create event with proxy function and store it's index
    const index = this.on(event, (...args) => {
      // Call callback with all event arguments
      handler(...args);
      // Unsubscribe listener after event was fired
      this.events[event][index] = undefined;
    });
    return index;
  }

  /**
   * Sends game event to special player or everyone except sender.
   *
   * @param {any} event Sent event name
   * @param {?Number} to Client ID. When equals to -1, emits event to everyone, except sender
   * @param {any} args Message arguments
   * @memberof Room
   */
  gameSend(event, to = -1, ...args) {
    this.socket.emit('game:event', {
      connectionId: to,
      args,
    });
  }

  /**
   * Locally emits game event.
   * Calls all game listeners, subscribed with gameOn or gameOnce.
   *
   * @param {String} event Emitted event name
   * @param {Number} senderId Game event sender ID
   * @memberof NetworkingAPI
   */
  gameEmit(event, senderId, ...args) {
    // If event has at least one listener
    if (this.gameEvents[event]) {
      // Iterate over all of them
      for (let i = 0; i < this.gameEvents[event].length; i += 1) {
        // If handler wasn't removed
        if (this.gameEvents[event][i]) {
          // Call each subscribed listener
          this.gameEvents[event][i].call(this, senderId, ...args);
        }
      }
    }
  }

  /**
   * Subscribe to general game events.
   *
   * @param {string} event Subscribed event name
   * @param {function} handler Callback function. Called with (senderId, ...other arguments)
   * @returns {Number} Listener index in event array
   * @memberof NetworkingAPI
   */
  gameOn(event, handler) {
    // Make sure that we have array for our event
    if (!this.gameEvents[event]) this.gameEvents[event] = [];
    // Push callback to listeners list and return index
    return this.gameEvents[event].push(handler) - 1;
  }

  /**
   * Subscribe to next dispatched game event.
   *
   * @param {string} event Subscribed event name
   * @param {function} handler Callback function. Called with (senderId, ...other arguments)
   * @returns {Number} Listener index in event array
   * @memberof NetworkingAPI
   */
  gameOnce(event, handler) {
    // Create event with proxy function and store it's index
    const index = this.gameOn(event, (...args) => {
      // Call callback with all event arguments
      handler(...args);
      // Unsubscribe listener after event was fired
      this.gameEvents[event][index] = undefined;
    });
    return index;
  }

  /**
   * Exports some primary networking functions, that can be used by game api.
   *
   * @returns {Object} Contains .emit, .on and .once functions.
   */
  export() {
    const getConnectionId = (() => this.connectionId);
    return {
      emit: this.gameSend.bind(this),
      on: this.gameOn.bind(this),
      once: this.gameOnce.bind(this),
      getConnectionId: getConnectionId.bind(this),
    };
  }


  /**
   * Checks that room name is valid:
   * * It starts with real server index.
   * * It's length is more than minimal room name length.
   *
   * @static
   * @param {string} roomName - Checked room name
   * @returns {boolean} - Returns true if room name is valid
   * @memberof NetworkingAPI
   */
  static isValidRoomName(roomName) {
    // Get id's of all valid servers
    const serverIndexes = Object.keys(SERVERS);
    // Find server index from room name
    const serverIndex = serverIndexes.find(index => roomName.startsWith(index));
    // Room name must start from server index
    if (serverIndex == null) return false;
    // Real room name length is calculated without server index
    const realRoomLength = roomName.length - serverIndex.length;
    // Check that room name's length is >= minimal length
    return realRoomLength >= ROOM_SETTINGS.LENGTH_MIN;
  }
}

export default NetworkingAPI;
