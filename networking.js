const SocketIO = require('socket.io');
// const _ = require('lodash');
const debug = require('debug')('networking');
const { MESSAGE_TYPE, PLATFORM } = require('./enums.js');

const rooms = {};


/**
 * Generates random numberic name for room
 *
 * @param {number} [length=5] Room name length
 * @returns {string} A random numberic string with fixed length
 * @memberof Networking
 */
function generateRandomRoomName(length = 3) {
  const min = 10 ** (length - 1);
  const mult = min * 9;
  return `${Math.floor(Math.random() * mult) + min}`;
}

/**
 * Generates room name and makes sure that this room is empty.
 * Room name length is not guaranteed.
 *
 * @returns {string} Numberic room name
 * @memberof Networking
 */
function generateEmptyRoomName() {
  // Start generating room code from 3 digints
  for (let num = 3; ; num += 1) {
    // Tries to generate room name 100 times. If all of them failed room name length increases
    for (let i = 0; i < 100; i += 1) {
      const name = generateRandomRoomName(num);
      if (!(name in rooms)) {
        return name;
      }
    }
  }
}

/**
 * A class that is used to handle errors, that can happen in room joining / opening
 *
 * @class RoomError
 * @extends {Error}
 */
class RoomError extends Error {
  /**
   * Creates an instance of RoomError.
   * @param {any} message Localizable error message
   * @memberof RoomError
   */
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Room is a primary class that is used to put together connections, that have joined it.
 *
 * @class Room
 */
class Room {
  /**
   * Creates an instance of Room and pushes it to global list
   *
   * @param {Connection} hostPlayer
   * @param {string} roomName Room name
   * @param {?string} password Optional room password
   * @throws {RoomError} Can throw errors if user can't create room with these arguments.
   * Error message is localizable string, that can be sent to client
   * @memberof Room
   */
  constructor(hostConnection, roomName, password) {
    // Make sure that this room name is unique
    if (roomName in rooms) {
      // Room with this name is already exists
      throw new RoomError('error_room_exists');
    }

    // Add class reference to global index, so room with same name won't be created again
    rooms[roomName] = this;

    // Store room information
    this.name = roomName;
    this.password = password;

    // Store room host connection
    this.hostConnection = hostConnection;

    // Array for connected clients
    this.clientConnections = [];
  }

  /**
   * Add client to room.
   *
   * @param {Connection} client Connected client connection
   * @param {?string} password Optional room password
   * @throws {RoomError} Can throw errors if user is not authorized to join this room.
   * Error message is localizable string, that can be sent to client
   * @returns {number} Recieved player id
   * @memberof Room
   */
  join(client, password) {
    // Room has a password and it's different form password that user sent
    if (this.password != null && this.password !== password) {
      throw new RoomError('error_room_wrong_password');
    }
    // Store connection reference
    const id = this.clientConnections.push(client);
    // Send new player's session to all other clients
    this.emit('connections:join', -1, id, id, client.sesson);

    return id;
  }

  /**
   * Look ups for all connections and give it's sessions
   *
   * @returns {Object.<number, string>} a dictionary of clientId = session.
   * @memberof Room
   */
  getClientConnections() {
    return this.clientConnections
      .filter(x => x != null) // Don't care about removed connections
      .reduce((acc, connection) => {
        // Send values in a format of id: session
        acc[connection.id] = connection.session;
        return acc;
      }, {});
  }

  /**
   * Removes client from connection list
   *
   * @param {Connection} client Player connection
   * @return {void}
   * @memberof Room
   */
  removeClientReference(client) {
    const clientId = this.clientConnections.indexOf(client);
    this.clientConnections[clientId] = undefined;

    // If disconnected client is not host
    if (clientId !== -1) {
      // Send event to all remaining players
      this.emit('connections:disconnect', -1, null, clientId);
    }
  }

  /**
   * Returns client reference by ID
   *
   * @param {any} id Client ID
   * @returns {?Connection} Client
   * @memberof Room
   */
  getClientById(id) {
    if (id === 0) return this.hostConnection;
    return this.clientConnections[id + 1];
  }

  /**
   * Emits socket.io event for a player of all players
   *
   * @param {any} event Sent event name
   * @param {?Number|Array<Number>} clientId Client ID or Array of Client IDs.
   * If equals to null or -1 emist event to everyone.
   * @param {?Number|Array<Number>} exceptId Excepted Client ID.
   * Impacts only when event is emitted for everyone (clientId is not defined or -1)
   * @param {any} args Message arguments
   * @memberof Room
   */
  emit(event, clientId = -1, exceptId, ...args) {
    if (typeof clientId === 'number' && clientId !== -1) { // Emit event to one certain client
      const client = this.getClientById(clientId);
      // Don't emit event if client with this id is not found
      if (client) client.socket.emit(event, ...args);
    } else if (Array.isArray(clientId)) { // Emit event to a list of clients
      // Iterate over array and execute same code as above
      clientId.forEach((id) => {
        const client = this.getClientById(id);
        // Don't emit event if client with this id is not found
        if (client) client.socket.emit(event, ...args);
      });
    } else if (clientId == null || clientId === -1) { // Emit event to everyone
      // Store some varibales to get them only once, instead of on each iteration
      const exceptType = typeof except;
      const exceptIsArray = Array.isArray(exceptId);
      // This function checks a connection and emits event for it, if it's not excluded
      const checkConnection = (client) => {
        if (exceptIsArray) {
          // If except is array we must make sure that current client is not included in this array
          if (!exceptId.includes(client.clientId)) {
            client.socket.emit(event, ...args);
          }
        } else if (exceptId == null || exceptId === -1) {
          // except is not defined, emit event anyway
          client.socket.emit(event, ...args);
        } else if (exceptType === 'number' && exceptId !== client.socket.clientId) {
          // Except is clientId. Just make sure that it not equals to client's id
          client.socket.emit(event, ...args);
        }
      };
      // Iterate over all connected clients
      this.clientConnections.forEach(checkConnection);
      // clientConnections not contains host, so call checkConnection for it separately
      checkConnection(this.hostConnection);
    } else {
      throw new Error('Bad arguments');
    }
  }

  /**
   * Set's current game and notifies all connections about it
   *
   * @param {any} game
   * @memberof Room
   */
  setGame(game) {
    this.game = game;
    this.emit('game:set', -1, null, game);
  }

  /**
   * Disconnects all clients and removes room from global list
   *
   * @memberof Room
   */
  dispose() {
    this.hostConnection.leaveRoom();
    this.clientConnections.forEach(client => client.leaveRoom());

    delete rooms[this.name];
  }
}

/**
 * A socket.io connection to one certain client.
 * Provides functions for interacting with Networking client api.
 *
 * @class Connection
 */
class Connection {
  /**
   * Creates an instance of Connection and handles all client messages
   *
   * @param {SocketIO} socket client socket
   * @param {Networking} networking parent networking class
   * @memberof Connection
   */
  constructor(socket, networking) {
    this.networking = networking;
    this.socket = socket;

    // Client session. Can be used to keep player's game statistics between connects
    this.sesson = generateRandomRoomName(15); // TODO, just a stub now

    // Client id in room
    this.clientId = -1;

    // A client wants to join to empty room.
    socket.on('room:open', (password) => {
      if (this.isInRoom) return;
      const roomName = generateEmptyRoomName();
      if (roomName) this.openRoom(roomName, password);
    });

    // A client wants to join some specific room
    socket.on('room:join', (roomName, password) => {
      if (this.isInRoom) return;
      if (roomName) this.joinRoom(roomName, password);
    });

    // A clients wants to leave room
    socket.on('room:leave', () => {
      // We can't leave room, if we are not in room
      if (!this.isInRoom) return;
      this.leaveRoom();
    });

    // Desktop client has chosen game
    socket.on('game:set', (game) => {
      // Game can be setted only in room
      if (!this.isInRoom) return;
      // Only desktop can update current game
      if (this.platform === PLATFORM.DESKTOP) {
        // We should update game in current room
        this.room.setGame(game);
      }
    });

    // Generic message type used by games
    socket.on('game:event', (message) => {
      if (this.isInRoom) {
        if (message.clientId != null && message.clientId !== -1) {
          // Dispatch event to special client
          this.room.emit('game:event', message.clientId, {
            sender: this.clientId,
            event: message.event,
            args: message.args,
          });
        } else {
          // Dispatch event to whole room, except sender
          this.room.emit('game:event', -1, [this.clientId], {
            sender: this.clientId,
            event: message.event,
            args: message.args,
          });
        }
      }
    });

    // Client attempts to send login information.
    // Probably later we can use RESTful api for this
    socket.on('login', (content) => {
      debug('login: ', content.username, content.password);
      socket.emit('login', {
        level: 100,
      });
    });
  }

  /**
   * Get's a platform, where this api is runned, based on client id,
   * becasuse desktop clients are always hosts
   *
   * @returns {?PLATFORM} Current platform. Can be null, if socket is not connected yet.
   * @readonly
   */
  get platform() {
    if (this.clientId === -1) return null; // Connection to socket is not established.
    // Desktop always has id 0
    return this.clientId === 0 ?
      PLATFORM.DESKTOP :
      PLATFORM.CONTROLLER;
  }

  /**
   * Returns if player has joined any room
   *
   * @returns {Boolean} If player has joined any room
   * @memberof Connection
   */
  get isInRoom() {
    return this.clientId !== -1;
  }

  /**
   * Makes client to open specific room.
   *
   * @param {any} roomName Specified room name
   * @param {?String} password Optional room password
   * @return {Boolean} Returns true if attempt to open room was successful
   * @memberof Connection
   */
  openRoom(roomName, password) {
    if (this.isInRoom) return false; // Client should leave room first.
    if (!roomName || typeof roomName !== 'string') throw new Error('Invalid room name');
    // Try to create new room
    try {
      this.room = new Room(this, roomName, password);
    } catch (err) {
      // For some reason we can't create this room
      if (err instanceof RoomError) {
        // Notify user about it
        this.socket.emit('room:status', {
          error: err.message,
        });
        return false;
      }
      // We should handle here only room errors
      throw err;
    }
    // Host always has 0 id
    this.clientId = 0;
    // Say client that we opened room
    this.socket.emit('room:status', {
      name: roomName,
      clientId: this.clientId,
    });
    return true;
  }

  /**
   * Makes client to join specific room.
   *
   * @param {String} roomName Specified room name
   * @param {?String} password Optional room password
   * @return {Boolean} Returns true if attempt to join was successful
   * @memberof Connection
   */
  joinRoom(roomName, password) {
    if (this.isInRoom) return false; // Client should leave room first.
    if (!roomName || typeof roomName !== 'string') throw new Error('Invalid room name');
    if (!(roomName in rooms)) {
      // This room not exists
      this.socket.emit('room:status', {
        error: 'error_room_not_exists',
      });
      return false;
    }
    // Try to join to opened room and store recieved id
    try {
      this.clientId = rooms[roomName].join(this, password);
    } catch (err) {
      // For some reason we can't join this room
      if (err instanceof RoomError) {
        // Notify user about it
        this.socket.emit('room:status', {
          error: err.message,
        });
        return false;
      }
      // We should handle here only room errors
      throw err;
    }

    // Store room refrence
    this.room = rooms[roomName];

    // Say client that we joined room
    this.socket.emit('room:status', {
      name: roomName,
      clientId: this.clientId,
      connections: this.room.getClientConnections(),
    });

    return true;
  }

  /**
   * Makes client to leave current room
   *
   * @returns {void}
   * @memberof Connection
   */
  leaveRoom() {
    // Leave only if we are already in some room
    if (this.isInRoom) {
      // Reset room status
      this.clientId = -1;
      this.room = undefined;
      // Notify user about it
      this.socket.emit('room:status');
    }
  }

  /**
   * Creates message box for player
   *
   * @param {?Object} options Message options
   * @param {?MESSAGE_TYPE} options.type Message type
   * @param {?String} options.text Message text
   * @param {?String} options.title Message title
   * @return {void}
   * @memberof Connection
   */
  msgBox(options = {}) {
    this.socket.emit('system:msgbox', {
      type: options.type || MESSAGE_TYPE.EMPTY,
      text: options.text,
      title: options.title,
    });
  }
}

/**
 * Main class that is responsible for handling all global connections.
 *
 * @class Networking
 */
class Networking {
  /**
   * Creates an instance of Networking.
   * @param {Object} options Options
   * @param {!Number} options.port Socket.io server port
   * @param {Boolean} options.isLocal Is that server hosted on local network?
   * @memberof Networking
   */
  constructor(options = {}) {
    this.connections = [];
    this.isLocal = options.isLocal != null ? options.isLocal : false;
    this.port = options.port;
  }

  /**
   * Creates socket.io instance and subscribes it to all system events
   *
   * @returns {void}
   * @memberof Networking
   */
  listen() {
    if (this.isReady) throw new Error('Networking.listen was called already');

    // Creating socket.io instance
    this.socket = new SocketIO(this.port);

    // Listening to all incoming connections
    this.socket.on('connect', this.addConnection);
  }

  /**
   * Finds out if socket is created already
   *
   * @returns {Boolean} Is socket created?
   * @memberof Networking
   */
  get isReady() {
    return this.socket != null;
  }

  /**
   * A port used by socket.io server
   *
   * @returns {number} Server port
   * @memberof Networking
   */
  getPort() {
    return this.port;
  }

  /**
   * Creates a connection for client socket
   *
   * @param {Object} clientSocket Connected client's socket
   * @returns {number} Index in connections array
   * @memberof Networking
   */
  addConnection(clientSocket) {
    return new Connection(clientSocket, this);
  }
}

module.exports = Networking;
