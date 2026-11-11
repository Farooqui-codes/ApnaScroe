const mongoose = require('mongoose');

const inningsSchema = new mongoose.Schema(
  {
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true, index: true },
    inningsNumber: { type: Number, required: true, min: 1 },
    battingTeamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
    battingTeamName: { type: String, required: true },
    bowlingTeamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
    bowlingTeamName: { type: String, required: true },
    target: { type: Number, default: null },
    openingStrikerId: { type: String, default: null },
    openingStrikerName: { type: String, default: '' },
    openingNonStrikerId: { type: String, default: null },
    openingNonStrikerName: { type: String, default: '' },
    openingBowlerId: { type: String, default: null },
    openingBowlerName: { type: String, default: '' },
    status: {
      type: String,
      enum: ['upcoming', 'live', 'paused', 'completed', 'abandoned'],
      default: 'live'
    },
    totalRuns: { type: Number, default: 0 },
    wickets: { type: Number, default: 0 },
    legalBalls: { type: Number, default: 0 },
    oversString: { type: String, default: '0.0' },
    extrasBreakdown: {
      wides: { type: Number, default: 0 },
      noBalls: { type: Number, default: 0 },
      byes: { type: Number, default: 0 },
      legByes: { type: Number, default: 0 },
      overthrows: { type: Number, default: 0 },
      penalties: { type: Number, default: 0 },
      customExtras: { type: Number, default: 0 },
      total: { type: Number, default: 0 }
    },
    computedState: { type: mongoose.Schema.Types.Mixed, default: null },
    lastSequence: { type: Number, default: 0 }
  },
  { timestamps: true }
);

inningsSchema.index({ matchId: 1, inningsNumber: 1 }, { unique: true });

module.exports = mongoose.model('Innings', inningsSchema, 'innings');
