const mongoose = require('mongoose');

const scoringRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    presetId: { type: String, default: 'custom', index: true },
    description: { type: String, trim: true, default: '' },
    isSystemPreset: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    rules: { type: mongoose.Schema.Types.Mixed, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ScoringRule', scoringRuleSchema, 'scoringRules');
