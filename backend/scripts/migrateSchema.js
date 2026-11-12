require('dotenv').config();
const { connectDB, disconnectDB } = require('../config/db');
const Match = require('../models/Match');
const Delivery = require('../models/Delivery');
const Tournament = require('../models/Tournament');
const User = require('../models/User');
const Player = require('../models/Player');

async function runMigration() {
  await connectDB();
  console.log('[ApnaScore Migration] Connected to MongoDB.');

  // 1. Backfill Match.ownerId & Match.version
  const matchUpdates = await Match.updateMany(
    { version: { $exists: false } },
    { $set: { version: 1 } }
  );
  const matchesNeedOwner = await Match.find({ userId: { $ne: null }, ownerId: null }).select('_id userId').lean();
  if (matchesNeedOwner.length) {
    await Match.bulkWrite(
      matchesNeedOwner.map((m) => ({
        updateOne: { filter: { _id: m._id }, update: { $set: { ownerId: m.userId } } }
      }))
    );
  }
  console.log(`[ApnaScore Migration] Matches updated -> version: ${matchUpdates.modifiedCount}, ownerId: ${matchesNeedOwner.length}`);

  // 2. Backfill Delivery.clientActionId for idempotency
  const deliveries = await Delivery.find({
    $or: [{ clientActionId: { $exists: false } }, { clientActionId: null }]
  }).select('_id matchId eventId').lean();
  if (deliveries.length) {
    await Delivery.bulkWrite(
      deliveries.map((d) => ({
        updateOne: {
          filter: { _id: d._id },
          update: { $set: { clientActionId: `${d.matchId}:${d.eventId}` } }
        }
      }))
    );
  }
  console.log(`[ApnaScore Migration] Deliveries backfilled with clientActionId: ${deliveries.length}`);

  // 3. Sync indexes across core collections
  await Promise.all([
    Match.syncIndexes(),
    Delivery.syncIndexes(),
    Tournament.syncIndexes(),
    User.syncIndexes(),
    Player.syncIndexes()
  ]);
  console.log('[ApnaScore Migration] Indexes synchronized successfully.');

  await disconnectDB();
}

runMigration().catch(async (err) => {
  console.error('[ApnaScore Migration] Failed:', err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
