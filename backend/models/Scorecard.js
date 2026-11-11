const mongoose = require('mongoose');

const scorecardSchema = new mongoose.Schema(
  {
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true, unique: true, index: true },
    title: { type: String, required: true },
    tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', default: null },
    tournamentName: { type: String, default: '' },
    venue: { type: String, default: '' },
    matchDate: { type: Date },
    tossText: { type: String, default: '' },
    resultText: { type: String, default: '' },
    playerOfMatch: { type: String, default: '' },
    inningsSummaries: [{ type: mongoose.Schema.Types.Mixed }],
    generatedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Scorecard', scorecardSchema, 'scorecards');
