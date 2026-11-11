const mongoose = require('mongoose');

const guestMigrationJobSchema = new mongoose.Schema(
  {
    migrationId: { type: String, required: true, unique: true, index: true },
    guestId: { type: String, required: true, index: true },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'partially_completed', 'completed', 'failed'],
      default: 'pending',
      index: true
    },
    importedCounts: {
      matches: { type: Number, default: 0 },
      teams: { type: Number, default: 0 },
      players: { type: Number, default: 0 },
      innings: { type: Number, default: 0 },
      deliveries: { type: Number, default: 0 },
      customRules: { type: Number, default: 0 },
      scorecards: { type: Number, default: 0 }
    },
    idMappings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ teams: {}, players: {}, matches: {}, innings: {}, rules: {} })
    },
    verified: { type: Boolean, default: false },
    errorDetails: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('GuestMigrationJob', guestMigrationJobSchema, 'guestMigrationJobs');
