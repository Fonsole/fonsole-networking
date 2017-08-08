const SocketIO = require('socket.io');
const debug = require('debug')('networking');
const { MESSAGE_TYPE, PLATFORM, ROOM_SETTINGS } = require('./enums.js');

const rooms = {};

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
    this.name = 'RoomError';
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

    console.log(`Opened new room: ${roomName}, by 0 client - session: ${hostConnection.session}`);

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
   * @returns {number} Received player id
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
    this.emit('connections:join', -1, id, id, client.session);

    console.log(`Client (id: ${id}, session: ${client.session}) has joined room '${this.name}'`);

    return id;
  }

  /**
   * Look ups for all connections and give it's sessions
   *
   * @returns {Object.<number, string>} a dictionary of connection id's and sessions
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
   * Removes connection from connection list
   *
   * @param {Connection} connectionId Connection ID
   * @return {void}
   * @memberof Room
   */
  removeConnection(connectionId) {
    this.clientConnections[connectionId] = undefined;

    // If disconnected client is not host,
    // otherwise they will notice it just by disconnecting from room
    if (connectionId !== 0) {
      // Send event to all remaining players
      this.emit('connections:disconnect', -1, null, connectionId);
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
   * @param {?Number|Array<Number>} connectionId Connection ID or Array of Connection IDs.
   * If equals to null or -1 emits event to everyone.
   * @param {?Number|Array<Number>} exceptId Excepted Connection ID.
   * Impacts only when event is emitted for everyone (connectionId is not defined or -1)
   * @param {any} args Message arguments
   * @memberof Room
   */
  emit(event, connectionId = -1, exceptId, ...args) {
    if (typeof connectionId === 'number' && connectionId !== -1) { // Emit event to one certain client
      const client = this.getClientById(connectionId);
      // Don't emit event if client with this id is not found
      if (client) client.socket.emit(event, ...args);
    } else if (Array.isArray(connectionId)) { // Emit event to a list of clients
      // Iterate over array and execute same code as above
      connectionId.forEach((id) => {
        const client = this.getClientById(id);
        // Don't emit event if client with this id is not found
        if (client) client.socket.emit(event, ...args);
      });
    } else if (connectionId == null || connectionId === -1) { // Emit event to everyone
      // Store some variables to get them only once, instead of on each iteration
      const exceptType = typeof except;
      const exceptIsArray = Array.isArray(exceptId);
      // This function checks a connection and emits event for it, if it's not excluded
      const checkConnection = (client) => {
        if (exceptIsArray) {
          // If except is array we must make sure that current client is not included in this array
          if (!exceptId.includes(client.connectionId)) {
            client.socket.emit(event, ...args);
          }
        } else if (exceptId == null || exceptId === -1) {
          // except is not defined, emit event anyway
          client.socket.emit(event, ...args);
        } else if (exceptType === 'number' && exceptId !== client.socket.connectionId) {
          // Except is connectionId. Just make sure that it not equals to client's id
          client.socket.emit(event, ...args);
        }
      };
      // Iterate over all connected clients
      this.clientConnections.filter(x => x != null).forEach(checkConnection);
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
    // Kick all valid clients
    this.clientConnections.filter(x => x != null).forEach(client => client.leaveRoom(true));

    console.log(`Room disposed: ${this.name}`);

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
    this.session = socket.id; // TODO, just a stub now

    // Client id in room
    this.connectionId = -1;

    console.log(`Opened new connection - session: ${this.session}`);

    // Handle disconnect event
    socket.on('disconnect', () => {
      this.dispose();
      console.log(`Disconnected - id: ${this.connectionId}, session: ${this.session}`);
    });

    // A client wants to join to empty room.
    socket.on('room:open', (password) => {
      if (this.isInRoom) return;
      // eslint-disable-next-line no-use-before-define
      const roomName = Networking.generateEmptyRoomName();
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
      this.leaveRoom(true);
    });

    // Desktop client has chosen game
    socket.on('game:set', (game) => {
      // Game can be updated only in room
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
        if (message.connectionId != null && message.connectionId !== -1) {
          // Dispatch event to special client
          this.room.emit('game:event', message.connectionId, {
            sender: this.connectionId,
            event: message.event,
            args: message.args,
          });
        } else {
          // Dispatch event to whole room, except sender
          this.room.emit('game:event', -1, [this.connectionId], {
            sender: this.connectionId,
            event: message.event,
            args: message.args,
          });
        }
      }
    });

    // Client attempts to send login information.
    // Probably later we can use restful api for this
    socket.on('login', (content) => {
      debug('login: ', content.username, content.password);
      socket.emit('login', {
        level: 100,
      });
    });
  }

  /**
   * Returns a platform, where this api is executed, based on client id,
   * because desktop clients are always hosts
   *
   * @returns {?PLATFORM} Current platform. Can be null, if socket is not connected yet.
   * @readonly
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
   * @memberof Connection
   */
  get isInRoom() {
    return this.connectionId !== -1;
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
    this.connectionId = 0;
    // Say client that we opened room
    this.socket.emit('room:status', {
      connectionId: this.connectionId,
      roomName,
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
    // Try to join to opened room and store received id
    try {
      this.connectionId = rooms[roomName].join(this, password);
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

    // Store room reference
    this.room = rooms[roomName];

    // Say client that we joined room
    this.socket.emit('room:status', {
      connections: this.room.getClientConnections(),
      connectionId: this.connectionId,
      roomName,
    });

    return true;
  }

  /**
   * Makes client to leave current room
   * If it's host connection room will be closed.
   *
   * @param {boolean} notify - Should we send user a message about it?
   * @returns {void}
   * @memberof Connection
   */
  leaveRoom(notify) {
    // Leave only if we are already in some room
    if (this.isInRoom) {
      // Remove connection reference from room
      this.room.removeConnection(this.connectionId);

      // If disconnected connection is host we should close room.
      if (this.connectionId === 0) {
        this.room.dispose();
      }

      // Reset room status
      this.connectionId = -1;
      this.room = undefined;
      // Notify user about it
      if (notify) this.socket.emit('room:status');
    }
  }

  /**
   * Removes all connection references, so we can be sure that this class will be noticed by gc.
   *
   * @memberof Connection
   */
  dispose() {
    // Leave room, so reference can be removed from it.
    this.leaveRoom(false);
    this.socket = undefined;
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
   * @memberof Networking
   */
  constructor(options = {}) {
    this.connections = [];
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

  /**
   * Generates random numeric name for room
   *
   * @static
   * @param {?number} length - Room name length
   * @returns {string} - A random numeric string with fixed length
   * @memberof Networking
   */
  static generateRandomRoomName(length = ROOM_SETTINGS.LENGTH_MIN) {
    const min = 10 ** (length - 1);
    const multiplier = min * 9;
    return `${Math.floor(Math.random() * multiplier) + min}`;
  }

  /**
   * Generates room name and makes sure that this room is empty.
   * Room name length is not guaranteed.
   *
   * @static
   * @returns {string} - Numeric room name
   * @memberof Networking
   */
  static generateEmptyRoomName() {
    // Start generating room code from 3 digits
    for (let num = 3; ; num += 1) {
      // Tries to generate room name 100 times. If all of them failed room name length increases
      for (let i = 0; i < 100; i += 1) {
        const name = Networking.generateRandomRoomName(num);
        if (!(name in rooms)) {
          return name;
        }
      }
    }
  }
}

module.exports = Networking;
