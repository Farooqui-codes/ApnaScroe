const mongoose = require('mongoose');

const awardSchema = new mongoose.Schema(
  {
    awardType: {
      type: String,
      enum: ['player_of_match', 'orange_cap', 'purple_cap', 'player_of_tournament', 'best_fielder', 'custom'],
      required: true,
      index: true
    },
    title: { type: String, required: true },
    playerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true, index: true },
    playerName: { type: String, required: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
    teamName: { type: String, default: '' },
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', default: null },
    tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', default: null },
    metricText: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Award', awardSchema, 'awards');
