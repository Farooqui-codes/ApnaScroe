const mongoose = require('mongoose');
const config = require('./env');

async function connectDB(overrideUri) {
  const uri = overrideUri || config.mongoUri || 'mongodb://127.0.0.1:27017/apnascore';

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
    maxPoolSize: 20
  });

  return mongoose.connection;
}

module.exports = { connectDB };
