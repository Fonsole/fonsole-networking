const SocketIO = require('socket.io');
// const _ = require('lodash');
const debug = require('debug')('networking');
const { MESSAGE_TYPE, PLATFORM } = require('./enums.js');

const roomPasswords = {};

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
    this.roomName = '/'; // By defalut client joins to global room

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
    socket.on('join-room-empty', (content) => {
      if (this.isInRoom) return; // For now players can join only one room per session
      const roomName = networking.generateEmptyRoomName();
      const password = content.password;
      if (roomName) this.joinRoom(roomName, password);
    });

    // A client wants to join some specific room
    socket.on('join-room', (content) => {
      if (this.isInRoom) return; // For now players can join only one room per session
      const roomName = content.roomName;
      const password = content.password;
      if (roomName) this.joinRoom(roomName, password);
    });

    // Generic message type, used by games
    socket.on('game-event', (content) => {
      socket.broadcast.to(this.roomName).emit('game-event', content);
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
  isInRoom() {
    return this.roomName !== '/';
  }

  /**
   * Makes client to join specific room.
   *
   * @param {any} roomName Specified room name
   * @param {?string} password Optional room password
   * @return {Boolean} Returns true if attempt to join was successful
   * @memberof Connection
   */
  joinRoom(roomName, password) {
    if (!roomName || typeof roomName !== 'string') throw new Error('Invalid room name');
    // Support for private rooms
    if (roomName in roomPasswords) {
      // Get users connected to room
      const roomUsers = this.networking.calculateClientsInRoomCount(roomName);
      // Room is empty, password can be removed
      if (!roomUsers) {
        delete roomPasswords[roomName];
      } else if (roomPasswords[roomName] !== password) {
        // Password is wrong, can't connect to room.
        // Send user a error messsage and let it retry.
        this.message({
          type: MESSAGE_TYPE.WARNING,
          text: 'error_wrong_password',
        });
        return false;
      }
    }

    // When all checks are completed we can actually put player to room
    this.roomName = roomName;
    this.socket.join(roomName);

    this.socket.emit('room-joined', roomName);

    // Send all clients information about new connection
    if (this.isInRoom()) {
      this.socket.to(this.roomName).emit('new-device', this.socket.id);
    }

    return true;
  }

  /**
   * Sends user a message.
   * 
   * @param {Object} options Message options
   * @param {!MESSAGE_TYPE} options.type Message type
   * @param {!String} options.text Message text
   * @param {!String} options.title Message title
   * @return {void}
   * @memberof Connection
   */
  message(options) {
    this.socket.emit('popup-message', {
      type: options.type || MESSAGE_TYPE.EMPTY,
      text: options.text,
      title: options.title,
    });
  }

  disconnect() { // eslint-disable-line

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
    const connection = new Connection(clientSocket, this);
    return this.connections.push(connection) - 1;
  }

  calculateClientsInRoomCount(name) {
    return this.socket.clients(name).length;
  }

  /**
   * Generates random numberic name for room
   *
   * @static
   * @param {number} [length=5] Room name length
   * @returns {string} A random numberic string with fixed length
   * @memberof Networking
   */
  static generateRandomRoomName(length = 5) {
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
  generateEmptyRoomName() {
    for (let num = 5; ; num += 1) {
      // Tries to generate room name 100 times. If all of them failed room name length increases
      for (let i = 0; i < 100; i += 1) {
        const name = Networking.generateRandomRoomName(num);
        if (!this.calculateClientsInRoomCount(name)) {
          return name;
        }
      }
    }
  }
}
module.exports = Networking;
