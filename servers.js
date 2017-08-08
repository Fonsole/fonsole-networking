/**
 * @file List of all available servers.
 *       First address of arrays is socket.io server address.
 *       Second address is a ping check url, that must return 200 status code.
 */

const SERVERS = process.env.NODE_ENV === 'production' ? {
  0: ['http://127.0.0.1:3001/', 'http://127.0.0.1/ping'],
} : {
  0: ['http://127.0.0.1:3001/', 'http://127.0.0.1/ping'],
  1: ['http://127.0.0.1:3001/', 'http://127.0.0.1/ping'],
};

export default SERVERS;
