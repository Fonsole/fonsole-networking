# fonsole-networking
This is a socket.io-based component, that inclueds both client and server files. This repository most likely also will be private.

### All Repositories:
#### [Desktop Repo](https://github.com/darklordabc/fonsole-desktop)
Main repo, this is the desktop version of the game (bigscreen), it is the main view that all the players will see for the games, typically on a large monitor/tv, uses electron.

Dependencies:
* [Networking Repo](#networking-repo)

#### [API Repo](https://github.com/darklordabc/fonsole-api)
This is the public API that developers can explore to see how to develop games for fonsole.

#### [Server Repo](https://github.com/darklordabc/fonsole-server)
This is the server component of fonsole. It will eventually be made private.

Dependencies:
* [Networking Repo](#networking-repo)
* [API Repo](#api-repo)

#### [Networking Repo](https://github.com/darklordabc/fonsole-networking)
This is a socket.io-based component, that inclueds both client and server files. This repository most likely also will be private.
* Server is located in `networking.js` file and is exported by default. Contains everything that is releated to rooms and working with client connections.
* Client part is located in `client` directory. Has everything that can be used for communication with server part. Also has a `export` that returns object with functions, that can be used by [Public API](#api-repo).
