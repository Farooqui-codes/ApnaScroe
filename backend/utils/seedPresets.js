const ScoringRule = require('../models/ScoringRule');
const engine = require('../services/scoringEngine');

async function seedSystemPresets() {
  const presets = engine.getRulePresets();
  for (const preset of presets) {
    const existing = await ScoringRule.findOne({ presetId: preset.presetId, isSystemPreset: true });
    if (!existing) {
      await ScoringRule.create({
        name: preset.presetName,
        presetId: preset.presetId,
        description: `Built-in ${preset.presetName} configuration`,
        isSystemPreset: true,
        rules: preset
      });
    }
  }
}

module.exports = { seedSystemPresets };
