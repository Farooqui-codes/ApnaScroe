const mongoose = require('mongoose');

const matchPlayerSchema = new mongoose.Schema(
  {
    playerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true },
    name: { type: String, required: true },
    isSubstitute: { type: Boolean, default: false },
    isCaptain: { type: Boolean, default: false },
    isWicketkeeper: { type: Boolean, default: false }
  },
  { _id: false }
);

const matchSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    matchCode: { type: String, unique: true, index: true },
    clientMatchId: { type: String, unique: true, sparse: true, index: true },
    tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', default: null, index: true },
    fixtureId: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentFixture', default: null },
    teamA: {
      teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
      name: { type: String, required: true },
      shortName: { type: String, default: '' },
      logoUrl: { type: String, default: '' },
      squad: [matchPlayerSchema],
      captainId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },
      wicketkeeperId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null }
    },
    teamB: {
      teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
      name: { type: String, required: true },
      shortName: { type: String, default: '' },
      logoUrl: { type: String, default: '' },
      squad: [matchPlayerSchema],
      captainId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },
      wicketkeeperId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null }
    },
    matchDate: { type: Date, default: Date.now, index: true },
    venue: { type: String, required: true, trim: true, default: 'Village Ground' },
    matchType: {
      type: String,
      enum: ['friendly', 'tournament', 'practice', 'knockout', 'league', 'final', 'semi_final', 'super_over'],
      default: 'friendly'
    },
    ballType: {
      type: String,
      enum: ['tennis', 'leather', 'gully', 'street', 'box', 'school', 'custom'],
      default: 'tennis'
    },
    oversPerInnings: { type: Number, required: true, min: 1, max: 100 },
    playersPerTeam: { type: Number, default: 11, min: 2, max: 20 },
    toss: {
      winnerTeamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
      winnerTeamName: { type: String, default: '' },
      decision: { type: String, enum: ['bat', 'bowl', ''], default: '' }
    },
    // Immutable snapshot of scoring rules captured at match start
    rulesSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['upcoming', 'live', 'paused', 'innings_break', 'completed', 'tied', 'abandoned'],
      default: 'upcoming',
      index: true
    },
    currentInningsNumber: { type: Number, default: 1 },
    isSuperOver: { type: Boolean, default: false },
    parentMatchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', default: null },
    result: {
      winnerTeamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
      winnerTeamName: { type: String, default: '' },
      isTie: { type: Boolean, default: false },
      marginText: { type: String, default: '' },
      playerOfMatchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },
      playerOfMatchName: { type: String, default: '' }
    },
    officials: {
      umpire1: { type: String, default: '' },
      umpire2: { type: String, default: '' },
      scorerName: { type: String, default: '' }
    },
    scorerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    authorizedScorers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    scorerLock: {
      deviceId: { type: String, default: '' },
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      lockedAt: { type: Date, default: null }
    },
    isPublic: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Match', matchSchema, 'matches');
