const mongoose = require('mongoose');
const config = require('./env');

let memoryServer = null;
let listenersAttached = false;

async function connectDB(overrideUri) {
  if (!overrideUri && mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  let uri = overrideUri || config.mongoUri;

  if (!uri && config.allowMemoryDbFallback) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
    console.log('[ApnaScore] Using in-memory MongoDB fallback (ALLOW_MEMORY_DB_FALLBACK=true).');
  }

  if (!uri) {
    if (config.nodeEnv === 'production') {
      throw new Error('MONGODB_URI environment variable is required in production.');
    }
    uri = 'mongodb://127.0.0.1:27017/apnascore';
  }

  mongoose.set('strictQuery', true);

  if (!listenersAttached) {
    listenersAttached = true;
    mongoose.connection.on('error', (err) => {
      console.error('[ApnaScore MongoDB] Connection error:', err.message);
    });
    mongoose.connection.on('disconnected', () => {
      console.warn('[ApnaScore MongoDB] Disconnected. Mongoose will attempt to reconnect...');
    });
    mongoose.connection.on('reconnected', () => {
      console.log('[ApnaScore MongoDB] Reconnected.');
    });
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    heartbeatFrequencyMS: 10000,
    maxPoolSize: 20,
    minPoolSize: 2,
    retryWrites: true,
    w: 'majority'
  });

  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

module.exports = { connectDB, disconnectDB };
