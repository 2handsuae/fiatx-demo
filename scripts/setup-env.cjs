/**
 * Node 18 compatibility: globalThis.crypto is a lazy getter that may not be
 * initialized before ts-node loads. Setting it eagerly fixes "crypto is not
 * defined" errors in config-release scripts.
 */
if (!global.crypto) {
  global.crypto = require('crypto').webcrypto;
}
