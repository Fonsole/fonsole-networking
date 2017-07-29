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
function generateRandomRoomName(length = 5) {
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
  for (let num = 5; ; num += 1) {
    // Tries to generate room name 100 times. If all of them failed room name length increases
    for (let i = 0; i < 100; i += 1) {
      const name = generateRandomRoomName(num);
      if (!(name in rooms)) {
        return name;
      }
    }
  }
}

class Room {
  /**
   * Creates an instance of Room and pushes it to global list
   *
   * @param {Connection} hostPlayer
   * @param {string} roomName Room name
   * @param {?string} password Optional room password
   * @memberof Room
   */
  constructor(hostConnection, roomName, password) {
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
   * 
   *
   * @param {Connection} client Connected client connection
   * @param {?string} password Optional room password
   * @returns {number} Recieved player id
   * @memberof Room
   */
  join(client, password) {
    // Room has a password and it's different form password that user sent
    if (this.password != null && this.password !== password) {
      client.socket.emit('room-failed', 'error_room_wrong_password');
      return -1;
    }
    const id = this.clientConnections.push(client);
    client.socket.emit('room-joined', this.name, id);

    return id;
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
   * Emits socket.io event to special player
   * 
   * @param {any} event Sent event name
   * @param {?Number} to Client ID
   * @param {any} args Message arguments
   * @memberof Room
   */
  emitToPlayer(event, to = -1, ...args) {
    this.socket.emit(event, ...args);
    this.getClientById(to).disconnectFromRoom();
  }

  /**
   * Sends socket.io event to everyone in this room 
   * 
   * @param {any} event Sent event name
   * @param {any} args Message arguments
   * @memberof Room
   */
  emitToEveryone(event, ...args) {
    this.clientConnections.forEach(client => client.socket.emit(event, ...args));
  }

  /**
   * Sends socket.io event to everyone in this room 
   * 
   * @param {any} event Sent event name
   * @param {Number} excepted Excepted from sending player
   * @param {any} args Message arguments
   * @memberof Room
   */
  emitToEveryoneExcept(event, except, ...args) {
    this.clientConnections.forEach((client) => {
      if (client.clientId !== except) {
        client.socket.emit(event, ...args);
      }
    });
  }

  /**
   * Removes client from connection list
   * 
   * @param {Connection} client Player connection
   * @return {void}
   * @memberof Room
   */
  removeClientReference(client) {
    const clientIndex = this.clientConnections.indexOf(client);
    this.clientConnections[clientIndex] = undefined;
  }

  /**
   * Disconnects all clients and removes room from global list
   *
   * @memberof Room
   */
  dispose() {
    this.hostConnection.disconnectFromRoom();
    this.clientConnections.forEach(client => client.disconnectFromRoom());

    delete rooms[this.name];
  }
}

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

    this.clientId = -1;

    // Client send's it's platform
    socket.on('platform', (content) => {
      // Content should have .platform key. .platform should have {PLATFORM} type
      if (content.platform !== PLATFORM.CONTROLLER &&
        content.platform !== PLATFORM.DESKTOP) {
        debug('Bad socket content (platform) - ', content.platform);
        return;
      }
      this.platform = content.platform;
    });

    // A client wants to join to empty room.
    socket.on('open-room', (password) => {
      if (this.isInRoom) return;
      const roomName = generateEmptyRoomName();
      if (roomName) this.openRoom(roomName, password);
    });

    // A client wants to join some specific room
    socket.on('join-room', (roomName, password) => {
      if (this.isInRoom) return;
      if (roomName) this.joinRoom(roomName, password);
    });

    // Generic message type used by games
    socket.on('game-event', (content) => {
      if (this.isInRoom) {
        if (content.clientId) {
          this.room.emitToPlayer('game-event', content.clientId, {
            sender: this.clientId,
            event: content.event,
            args: content.args,
          });
        } else {
          this.room.emitToEveryoneExcept('game-event', this.clientId, {
            sender: this.clientId,
            event: content.event,
            args: content.args,
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
   * Returns if player has joined any room
   *
   * @returns {Boolean} If player has joined any room
   * @memberof Connection
   */
  get isInRoom() {
    return this.room != null;
  }

  /**
   * Makes client to open specific room.
   *
   * @param {any} roomName Specified room name
   * @param {?string} password Optional room password
   * @return {Boolean} Returns true if attempt to open room was successful
   * @memberof Connection
   */
  openRoom(roomName, password) {
    if (!roomName || typeof roomName !== 'string') throw new Error('Invalid room name');
    if (roomName in rooms) {
      // Room with this name is already exists
      this.socket.emit('room-failed', 'error_room_exists');
      return false;
    }
    // Create new room and store it's reference
    this.room = new Room(this, roomName, password);
    // Host always has 0 id
    this.clientId = 0;
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
    if (!roomName || typeof roomName !== 'string') throw new Error('Invalid room name');
    if (!(roomName in rooms)) {
      // This room not exists
      this.socket.emit('room-failed', 'error_room_not_exists');
      return false;
    }
    // Try to join to opened room and store recieved id
    this.clientId = rooms[roomName].join(this, password);
    if (this.clientId === -1) {
      // Room not allowed player to join.
      return false;
    }

    // Store room refrence
    this.room = rooms[roomName];

    return true;
  }

  /**
   * Disconnects player from current room
   * 
   * @returns {void}
   * @memberof Connection
   */
  disconnectFromRoom() {
    if (this.isInRoom) {
      this.room.removeClientReference(this);
      this.room = undefined;
      this.clientId = -1;
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
    this.socket.emit('popup-message', {
      type: options.type || MESSAGE_TYPE.EMPTY,
      text: options.text,
      title: options.title,
    });
  }
}

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
