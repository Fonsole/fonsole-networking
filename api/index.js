import io from 'socket.io-client';
import { MESSAGE_TYPE, PLATFORM } from '../enums'; // eslint-disable-line no-unused-vars

export default class NetworkingAPI {
  /**
   * Creates an instance of NetworkingAPI.
   * @param {string} [url=host:3001] Socket.io server url. By default equals to host:3001
   * @param {PLATFORM} platform Api platform
   * @memberof NetworkingAPI
   */
  constructor(url = (`${window.location.protocol}//${window.location.hostname}:3001`), platform) {
    this.events = {};
    // Store arguments for later use
    this.url = url;
    this.platform = platform;

    // Create socket.io
    this.socket = io(url);

    // Send client platform to server
    this.socket.emit('platform', {
      platform,
    });

    if (platform === PLATFORM.DESKTOP) {
      // Desktop version should create empty room just after it opened
      this.emit('join-room-empty');
    }

    this.socket.on('room-joined', (content) => {
      this.roomName = content.roomName;
      this.emit('room-joined', this.roomName);
    });
  }

  /**
   * Subscribe to general client events.
   * 
   * @param {string} event 
   * @param {function} callback 
   * @memberof NetworkingAPI
   */
  on(event, callback) {
    // Make sure that we have array for our event
    if (!this.events[event]) this.events[event] = [];
    // Push callback to listeners list
    this.events[event].push(callback);
  }

  /**
   * Emits general client event
   * 
   * @memberof NetworkingAPI
   */
  emit(event, ...content) {
    // If event has at least one listener
    if (this.events[event]) {
      // Iterate over all of them
      for (let i = 0; i < this.events[event].length; i += 1) {
        // And call each subscribed listener
        this.events[event][i].call(this, content);
      }
    }
  }
}
