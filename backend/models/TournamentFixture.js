const mongoose = require('mongoose');

const tournamentFixtureSchema = new mongoose.Schema(
  {
    tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true, index: true },
    roundName: { type: String, default: 'League Match' }, // Group A, Quarter-Final, Semi-Final, Final
    roundOrder: { type: Number, default: 1 },
    matchNumber: { type: Number, default: 1 },
    groupName: { type: String, default: 'Group A' },
    teamAId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
    teamAName: { type: String, default: 'TBD' },
    teamBId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
    teamBName: { type: String, default: 'TBD' },
    scheduledDate: { type: Date, default: null },
    scheduledTime: { type: String, default: '' },
    venue: { type: String, default: '' },
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', default: null },
    status: {
      type: String,
      enum: ['scheduled', 'live', 'completed', 'cancelled'],
      default: 'scheduled'
    },
    winnerTeamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
    resultText: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('TournamentFixture', tournamentFixtureSchema, 'tournamentFixtures');
