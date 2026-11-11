const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80, index: true },
    shortName: { type: String, trim: true, uppercase: true, maxlength: 8, default: '' },
    village: { type: String, required: true, trim: true, index: true },
    logoUrl: { type: String, default: '' },
    ownerName: { type: String, trim: true, default: '' },
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    captainId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },
    viceCaptainId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },
    players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }],
    inviteCode: { type: String, trim: true, default: '' },
    pendingInvites: [
      {
        playerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
        status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
        requestedAt: { type: Date, default: Date.now }
      }
    ],
    stats: {
      matchesPlayed: { type: Number, default: 0 },
      won: { type: Number, default: 0 },
      lost: { type: Number, default: 0 },
      tied: { type: Number, default: 0 },
      noResult: { type: Number, default: 0 },
      points: { type: Number, default: 0 },
      rankingPoints: { type: Number, default: 1000 }
    }
  },
  { timestamps: true }
);

teamSchema.index({ name: 1, village: 1 }, { unique: true });

module.exports = mongoose.model('Team', teamSchema, 'teams');
