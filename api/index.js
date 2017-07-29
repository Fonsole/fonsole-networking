const io = require('socket.io-client');
const { MESSAGE_TYPE, PLATFORM } = require('../enums'); // eslint-disable-line no-unused-vars

module.exports = class NetworkingAPI {
  /**
   * Creates an instance of NetworkingAPI.
   * @param {string} [url=host:3001] Socket.io server url. By default equals to host:3001
   * @param {PLATFORM} platform Api platform
   * @memberof NetworkingAPI
   */
  constructor(url = (`${window.location.protocol}//${window.location.hostname}:3001`), platform) {
    // Deafults
    this.events = {};
    this.gameEvents = {};
    this.clientId = -1;

    // Store arguments for later use
    this.url = url;
    this.platform = platform;

    // Create socket.io
    this.socket = io(url);

    // Send client platform to server
    this.socket.emit('platform', {
      platform,
    });

    // This event fires when we successfully opened/joined room
    this.socket.on('room-joined', (name, id) => {
      this.roomName = name;
      this.clientId = id;
      this.localEmit('room-joined', name, id);
    });

    // This event fires when we unsuccessfully opened/joined room
    this.socket.on('room-failed', (error) => {
      this.roomName = '';
      this.clientId = -1;
      this.localEmit('room-joined', error);
    });

    //
    this.socket.on('game-event', ({ sender, event, args }) => {
      this.gameEmit(event, sender, args);
    });

    // Map message event, so platform can define it itself
    this.mapSocketEvent('popup-message');

    if (platform === PLATFORM.DESKTOP) {
      // Desktop version should create empty room just after it opened
      this.openRoom();
    }
  }

  /**
   * Emits general client event each time socket recieves this event
   * Allows to subscribe to 
   * 
   * @param {String} event Subscribed event name
   */
  mapSocketEvent(event) {
    this.socket.on(event, (...content) => {
      this.localEmit(event, ...content);
    });
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
        this.events[event][i].call(this, content);
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
   * Makes client to open specific room.
   *
   * @param {?string} password Optional room password
   * @returns {Promise}
   * @memberof Connection
   */
  openRoom(password) {
    // Send command to socket.io server
    this.socket.emit('open-room', password);
    // Returning promise, that will be resolved once client opens room or recieved open error
    return new Promise((resolve, reject) => {
      this.once('room-joined', ...content => resolve(content));
      this.once('room-failed', ...content => reject(content));
    });
  }

  /**
   * Makes client to join specific room.
   *
   * @param {String} roomName Specified room name
   * @param {?String} password Optional room password
   * @returns {void}
   * @memberof Connection
   */
  joinRoom(roomName, password) {
    // Send command to socket.io server
    this.socket.emit('join-room', roomName, password);
    // Returning promise, that will be resolved once client joins room or recieved join error
    return new Promise((resolve, reject) => {
      this.once('room-joined', ...content => resolve(content));
      this.once('room-failed', ...content => reject(content));
    });
  }

  /**
   * Emits game event to special player
   * 
   * @param {any} event Sent event name
   * @param {?Number} to Client ID
   * @param {any} args Message arguments
   * @memberof Room
   */
  gameEmitToPlayer(event, to = -1, ...args) {
    this.socket.emit('game-event', {
      clientId: to,
      args,
    });
  }

  /**
   * Sends game event to everyone in this room
   * 
   * @param {any} event Sent event name
   * @param {any} args Message arguments
   * @memberof Room
   */
  gameEmitToEveryone(event, ...args) {
    this.socket.emit('game-event', {
      args,
    });
  }

  /**
   * Locally emits game event
   *
   * @param {String} event Emitted event name
   * @param {Number} senderId Game event sender ID
   * @memberof NetworkingAPI
   */
  gameEmit(event, senderId, ...content) {
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
   * @param {function} callback Callback function
   * @returns {Number} Listener index in event array
   * @memberof NetworkingAPI
   */
  gameOn(event, callback) {
    // Make sure that we have array for our event
    if (!this.gameEvents[event]) this.events[event] = [];
    // Push callback to listeners list and return index
    return this.gameEvents[event].push(callback) - 1;
  }

  /**
   * Subscribe to next fired game event
   * 
   * @param {string} event Subscribed event name
   * @param {function} callback Callback function
   * @returns {Number} Listener index in event array
   * @memberof NetworkingAPI
   */
  gameOnce(event, callback) {
    // Create event with proxy function and store it's index
    const index = this.on(event, (...args) => {
      // Call callback with all event arguments
      callback(...args);
      // Unsubscribe listener after event was fired
      this.gameEvents[event][index] = undefined;
    });
    return index;
  }
};
