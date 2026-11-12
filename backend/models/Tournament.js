const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120, index: true },
    season: { type: String, trim: true, default: String(new Date().getFullYear()) },
    village: { type: String, required: true, trim: true, index: true },
    organizerName: { type: String, trim: true, default: '' },
    organizerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignedScorers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    logoUrl: { type: String, default: '' },
    posterUrl: { type: String, default: '' },
    sponsorBannerUrl: { type: String, default: '' },
    sponsorName: { type: String, trim: true, default: '' },
    plan: { type: String, enum: ['free', 'pro'], default: 'free', index: true },
    proUnlockedAt: { type: Date, default: null },
    proPaymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
    publicRegistrationEnabled: { type: Boolean, default: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    registrationDeadline: { type: Date, default: null },
    entryFee: { type: Number, min: 0, default: 0 },
    prizeMoney: { type: String, trim: true, default: '' },
    maxTeams: { type: Number, min: 2, max: 64, default: 8 },
    oversPerMatch: { type: Number, min: 1, max: 50, default: 8 },
    ballType: { type: String, default: 'tennis' },
    format: {
      type: String,
      enum: ['knockout', 'league', 'round_robin', 'group_stage', 'league_knockout', 'double_elimination'],
      default: 'league_knockout'
    },
    isPublic: { type: Boolean, default: true, index: true },
    status: {
      type: String,
      enum: ['upcoming', 'registration_open', 'ongoing', 'completed', 'cancelled'],
      default: 'upcoming',
      index: true
    },
    rulesSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    pointsConfig: {
      win: { type: Number, default: 2 },
      loss: { type: Number, default: 0 },
      tie: { type: Number, default: 1 },
      noResult: { type: Number, default: 1 },
      tieBreaker: { type: String, enum: ['nrr', 'head_to_head', 'wins'], default: 'nrr' }
    },
    registeredTeams: [
      {
        teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
        groupName: { type: String, default: 'Group A' },
        status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
        captainName: { type: String, trim: true, default: '' },
        captainPhone: { type: String, trim: true, default: '' },
        playerNames: [{ type: String, trim: true }],
        feeStatus: { type: String, enum: ['pending', 'paid', 'waived'], default: 'pending' },
        feeAmountPaid: { type: Number, min: 0, default: 0 },
        paymentMode: { type: String, enum: ['cash', 'upi', 'bank', 'online', ''], default: '' },
        feeUpdatedAt: { type: Date, default: null },
        registeredAt: { type: Date, default: Date.now }
      }
    ],
    winnerTeamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
    runnerUpTeamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
    playerOfTournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },
    shareCode: { type: String, unique: true, sparse: true, index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Tournament', tournamentSchema, 'tournaments');
