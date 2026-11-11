const mongoose = require('mongoose');

const deliverySchema = new mongoose.Schema(
  {
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true, index: true },
    inningsId: { type: mongoose.Schema.Types.ObjectId, ref: 'Innings', required: true, index: true },
    inningsNumber: { type: Number, required: true },
    eventId: { type: String, required: true },
    sequence: { type: Number, required: true },
    eventType: {
      type: String,
      enum: [
        'delivery',
        'set_openers',
        'swap_batsmen',
        'change_striker',
        'change_bowler',
        'new_batsman',
        'retire',
        'end_over',
        'end_innings',
        'score_correction'
      ],
      default: 'delivery'
    },
    extraType: {
      type: String,
      enum: ['none', 'wide', 'no_ball', 'bye', 'leg_bye', 'penalty', 'custom_extra'],
      default: 'none'
    },
    batRuns: { type: Number, default: 0, min: 0 },
    additionalExtraRuns: { type: Number, default: 0, min: 0 },
    overthrowRuns: { type: Number, default: 0, min: 0 },
    deltaRuns: { type: Number, default: 0 },
    isFour: { type: Boolean, default: false },
    isSix: { type: Boolean, default: false },
    notBoundary: { type: Boolean, default: false },
    overthrowBoundary: { type: Boolean, default: false },
    isWicket: { type: Boolean, default: false },
    wicketType: { type: String, default: null },
    oneTipCatch: { type: Boolean, default: false },
    dismissedSlot: { type: String, default: null },
    dismissedPlayerId: { type: String, default: null },
    dismissedPlayerName: { type: String, default: '' },
    fielderId: { type: String, default: null },
    fielderName: { type: String, default: '' },
    strikerId: { type: String, default: null },
    strikerName: { type: String, default: '' },
    nonStrikerId: { type: String, default: null },
    nonStrikerName: { type: String, default: '' },
    bowlerId: { type: String, default: null },
    bowlerName: { type: String, default: '' },
    playerId: { type: String, default: null },
    playerName: { type: String, default: '' },
    replacementPlayerId: { type: String, default: null },
    replacementPlayerName: { type: String, default: '' },
    slot: { type: String, default: null },
    reason: { type: String, default: '' },
    commentary: { type: String, default: '' },
    isVoided: { type: Boolean, default: false, index: true },
    editedAt: { type: Date, default: null },
    clientTimestamp: { type: Date, default: Date.now },
    deviceId: { type: String, default: '' }
  },
  { timestamps: true }
);

// Idempotency & sequence guarantees for online + offline sync
deliverySchema.index({ matchId: 1, eventId: 1 }, { unique: true });
deliverySchema.index({ matchId: 1, inningsNumber: 1, sequence: 1 });

module.exports = mongoose.model('Delivery', deliverySchema, 'deliveries');
