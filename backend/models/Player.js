const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80, index: true },
    village: { type: String, required: true, trim: true, index: true },
    phone: { type: String, trim: true, default: '' },
    age: { type: Number, min: 6, max: 90, default: null },
    jerseyNumber: { type: Number, min: 0, max: 999, default: null },
    photoUrl: { type: String, default: '' },
    battingStyle: {
      type: String,
      enum: ['Right-hand bat', 'Left-hand bat'],
      default: 'Right-hand bat'
    },
    bowlingStyle: {
      type: String,
      enum: ['Right-arm fast', 'Right-arm medium', 'Right-arm offbreak', 'Right-arm legbreak', 'Left-arm fast', 'Left-arm medium', 'Left-arm orthodox', 'Left-arm chinaman', 'None'],
      default: 'Right-arm medium'
    },
    role: {
      type: String,
      enum: ['Batsman', 'Bowler', 'All-rounder', 'Wicketkeeper'],
      default: 'All-rounder'
    },
    teams: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Team' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    stats: {
      matches: { type: Number, default: 0 },
      innings: { type: Number, default: 0 },
      notOuts: { type: Number, default: 0 },
      runs: { type: Number, default: 0 },
      ballsFaced: { type: Number, default: 0 },
      highestScore: { type: Number, default: 0 },
      highestNotOut: { type: Boolean, default: false },
      average: { type: Number, default: 0 },
      strikeRate: { type: Number, default: 0 },
      fours: { type: Number, default: 0 },
      sixes: { type: Number, default: 0 },
      fifties: { type: Number, default: 0 },
      hundreds: { type: Number, default: 0 },
      oversBowledBalls: { type: Number, default: 0 },
      runsConceded: { type: Number, default: 0 },
      wickets: { type: Number, default: 0 },
      maidens: { type: Number, default: 0 },
      bowlingAverage: { type: Number, default: 0 },
      economy: { type: Number, default: 0 },
      bestBowlingWickets: { type: Number, default: 0 },
      bestBowlingRuns: { type: Number, default: 0 },
      catches: { type: Number, default: 0 },
      potmAwards: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
);

// Prevent accidental duplicate profiles in the same village with identical name & jersey
playerSchema.index({ name: 1, village: 1 });

module.exports = mongoose.model('Player', playerSchema, 'players');
