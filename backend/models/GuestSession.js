const mongoose = require('mongoose');

const guestSessionSchema = new mongoose.Schema(
  {
    guestId: { type: String, required: true, unique: true, index: true },
    deviceId: { type: String, required: true, index: true },
    sessionTokenHash: { type: String, required: true, select: false },
    status: {
      type: String,
      enum: ['active', 'migrated', 'expired'],
      default: 'active',
      index: true
    },
    migrationStatus: {
      type: String,
      enum: ['pending', 'in_progress', 'partially_completed', 'completed', 'failed'],
      default: 'pending',
      index: true
    },
    linkedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    lastActiveAt: { type: Date, default: Date.now },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('GuestSession', guestSessionSchema, 'guestSessions');
