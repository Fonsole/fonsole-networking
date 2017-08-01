import io from 'socket.io-client';
import { MESSAGE_TYPE, PLATFORM } from '../enums'; // eslint-disable-line no-unused-vars

/**
 * This class contains all functions, that fonsole provides for game development
 *
 * @class NetworkingAPI
 */
class NetworkingAPI {
  /**
   * Creates an instance of NetworkingAPI.
   * @param {string} [url=host:3001] Socket.io server url. By default equals to host:3001
   * @memberof NetworkingAPI
   */
  constructor(url = (`${window.location.protocol}//${window.location.hostname}:3001`)) {
    // Deafults
    this.clientConnections = {};
    this.events = {};
    this.gameEvents = {};
    this.connectionId = -1;

    // Store arguments for later use
    this.url = url;

    // Create socket.io
    this.socket = io(url);

    // This event fires when client joins / leaves room
    this.socket.on('room:status', (status = {}) => {
      if (status.roomName && status.id) {
        // Joined, save room status
        this.roomName = status.name;
        this.connectionId = status.connectionId;
        if (status.connections) {
          Object.assign(this.clientConnections, status.connections);
        }
      } else {
        // Left, clear room status
        this.roomName = '';
        this.connectionId = -1;
        this.clientConnections = {};
      }

      this.localEmit('room:status', status);
    });

    // New client joined same room
    this.socket.on('connections:join', (connectionId, session) => {
      // Store session
      this.clientConnections[connectionId] = session;
      // Emit event, so game's can handle it
      this.localEmit('connections:join', connectionId, session);
    });

    // Client has just disconnected from room
    this.socket.on('connections:disconnect', (connectionId) => {
      // Remove reference
      this.clientConnections[connectionId] = undefined;
      // Emit event, so game's can handle it
      this.localEmit('connections:disconnect', connectionId);
    });

    // Desktop has changed game
    this.socket.on('game:set', (game) => {
      // Store current game name
      this.game = game;
      // Remove events subscribed in previous game
      this.gameEvents = {};
      // Emit this event locally, so platform can handle this change
      this.localEmit('game:set', game);
    });

    // Redirect all game events to listeners
    this.socket.on('game:event', ({ sender, event, args }) => {
      this.gameLocalEmit(event, sender, args);
    });

    // Map message event, so platform can define it itself
    this.socket.on('system:msgbox', message => this.localEmit('system:msgbox', message));
  }

  /**
   * Set's current room's game.
   * Can be called only by desktop.
   *
   * @param {any} game
   * @memberof NetworkingAPI
   */
  setGame(game) {
    if (!game || typeof game !== 'string') throw new Error('Invalid game name');

    // Game can be setted only in room
    if (!this.isInRoom) return;

    // Only desktop can update current game. Server has same check.
    if (this.platform === PLATFORM.DESKTOP) {
      // Send event to server, so it can notify all connections about it.
      this.socket.emit('game:set', game);
    }
  }

  /**
   * Get's a platform, where this api is runned, based on client id,
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
   * Makes client to open specific room and become it's host
   *
   * @param {?string} password Optional room password
   * @returns {Promise} A promise that will be resolved when client successfully joins room
   * A resolved object contains { roomName, connectionId } properties
   * @memberof NetworkingAPI
   */
  openRoom(password) {
    // Send command to socket.io server
    this.socket.emit('room:open', password);
    // Returning promise, that will be resolved once client opens room or recieved open error
    return new Promise((resolve, reject) => {
      this.once('room:status', (status) => {
        // If we recieved client id and room then we actually joined room
        if (status.connectionId != null && status.roomName != null) {
          resolve(status);
        } else { // Otherwise there should be some error
          reject(status.error || '');
        }
      });
    });
  }

  /**
   * Makes client to join specific room.
   *
   * @param {String} roomName Specified room name
   * @param {?String} password Optional room password
   * @returns {Promise} A promise that will be resolved when client successfully joins room
   * A resolved object contains { roomName, connectionId, connections } properties
   * @memberof NetworkingAPI
   */
  joinRoom(roomName, password) {
    // Send command to socket.io server
    this.socket.emit('room:join', roomName, password);
    // Returning promise, that will be resolved once client joins room or recieved join error
    return new Promise((resolve, reject) => {
      this.once('room:status', (status) => {
        // If we recieved client id and room then we actually joined room
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
  localEmit(event, ...content) {
    // If event has at least one listener
    if (this.events[event]) {
      // Iterate over all of them
      for (let i = 0; i < this.events[event].length; i += 1) {
        // And call each subscribed listener
        this.events[event][i].call(this, ...content);
      }
    }
  }

  /**
   * Subscribe to general client events.
   *
   * @param {string} event Subscribed event name
   * @param {function} callback Callback function
   * @returns {Number} Listener index in event array
   * @memberof NetworkingAPI
   */
  on(event, callback) {
    // Make sure that we have array for our event
    if (!this.events[event]) this.events[event] = [];
    // Push callback to listeners list and return index
    return this.events[event].push(callback) - 1;
  }

  /**
   * Subscribe to next fired event
   *
   * @param {string} event Subscribed event name
   * @param {function} callback Callback function
   * @returns {Number} Listener index in event array
   * @memberof NetworkingAPI
   */
  once(event, callback) {
    // Create event with proxy function and store it's index
    const index = this.on(event, (...args) => {
      // Call callback with all event arguments
      callback(...args);
      // Unsubscribe listener after event was fired
      this.events[event][index] = undefined;
    });
    return index;
  }

  /**
   * Emits game event to special player or everyone except sender.
   *
   * @param {any} event Sent event name
   * @param {?Number} to Client ID. When equals to -1, emits event to everyone, except sender
   * @param {any} args Message arguments
   * @memberof Room
   */
  gameEmit(event, to = -1, ...args) {
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
  gameLocalEmit(event, senderId, ...content) {
    // If event has at least one listener
    if (this.gameEvents[event]) {
      // Iterate over all of them
      for (let i = 0; i < this.gameEvents[event].length; i += 1) {
        // And call each subscribed listener
        this.gameEvents[event][i].call(this, senderId, ...content);
      }
    }
  }

  /**
   * Subscribe to general game events.
   *
   * @param {string} event Subscribed event name
   * @param {function} callback Callback function. Called with (senderId, ...other arguments)
   * @returns {Number} Listener index in event array
   * @memberof NetworkingAPI
   */
  gameOn(event, callback) {
    // Make sure that we have array for our event
    if (!this.gameEvents[event]) this.gameEvents[event] = [];
    // Push callback to listeners list and return index
    return this.gameEvents[event].push(callback) - 1;
  }

  /**
   * Subscribe to next dispatched game event.
   *
   * @param {string} event Subscribed event name
   * @param {function} callback Callback function. Called with (senderId, ...other arguments)
   * @returns {Number} Listener index in event array
   * @memberof NetworkingAPI
   */
  gameOnce(event, callback) {
    // Create event with proxy function and store it's index
    const index = this.gameOn(event, (...args) => {
      // Call callback with all event arguments
      callback(...args);
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
      emit: this.gameEmit.bind(this),
      on: this.gameOn.bind(this),
      once: this.gameOnce.bind(this),
      getConnectionId: getConnectionId.bind(this),
    };
  }
}

export default NetworkingAPI;
