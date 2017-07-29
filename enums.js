module.exports = {
  /**
   * Message types for 'message' event
   * 
   * @readonly
   * @enum {String}
   */
  MESSAGE_TYPE: {
    EMPTY: 'empty',
    INFORMATION: 'information',
    WARNING: 'warning',
    ERROR: 'error',
  },
  /**
   * Platform types
   * 
   * @readonly
   * @enum {String}
   */
  PLATFORM: {
    CONTROLLER: 'controller',
    DESKTOP: 'desktop',
  },
};
