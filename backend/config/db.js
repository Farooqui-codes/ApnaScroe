const mongoose = require('mongoose');
const config = require('./env');

let memoryServer = null;

async function connectDB(overrideUri) {
  let uri = overrideUri || config.mongoUri;

  if (!uri && config.allowMemoryDbFallback) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
    console.log('[ApnaScore] Using in-memory MongoDB fallback (ALLOW_MEMORY_DB_FALLBACK=true).');
  }

  if (!uri) {
    uri = 'mongodb://127.0.0.1:27017/apnascore';
  }

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
    maxPoolSize: 20
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
