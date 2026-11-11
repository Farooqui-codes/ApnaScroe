const mongoose = require('mongoose');

const scoringRuleSchema = new mongoose.Schema(
  {
    ownerType: { type: String, enum: ['system', 'guest', 'user'], default: 'user', index: true },
    guestId: { type: String, default: null, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    clientId: { type: String, default: null, index: true },
    sourceGuestId: { type: String, default: null },
    migratedAt: { type: Date, default: null },

    name: { type: String, required: true, trim: true, maxlength: 80 },
    presetId: { type: String, default: 'custom', index: true },
    description: { type: String, trim: true, default: '' },
    isSystemPreset: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    rules: { type: mongoose.Schema.Types.Mixed, required: true }
  },
  { timestamps: true }
);

scoringRuleSchema.index({ sourceGuestId: 1, clientId: 1 }, { sparse: true });

module.exports = mongoose.model('ScoringRule', scoringRuleSchema, 'scoringRules');
