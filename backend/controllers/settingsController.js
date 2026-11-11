const ScoringRule = require('../models/ScoringRule');
const engine = require('../services/scoringEngine');

async function getSettings(req, res, next) {
  try {
    let query;
    if (req.user) {
      query = { $or: [{ isSystemPreset: true }, { createdBy: req.user._id }, { userId: req.user._id }] };
    } else if (req.guest) {
      query = { $or: [{ isSystemPreset: true }, { ownerType: 'guest', guestId: req.guest.guestId }] };
    } else {
      query = { isSystemPreset: true };
    }

    const savedPresets = await ScoringRule.find(query).sort({ isSystemPreset: -1, createdAt: -1 }).lean();

    res.json({
      success: true,
      preferences: req.user ? req.user.preferences : null,
      presets: savedPresets.length > 0 ? savedPresets : engine.getRulePresets().map((r) => ({
        name: r.presetName,
        presetId: r.presetId,
        isSystemPreset: true,
        rules: r
      }))
    });
  } catch (err) {
    next(err);
  }
}

async function updatePreferences(req, res, next) {
  try {
    const user = req.user;
    const { language, theme, outdoorMode, notifications, privacy, defaultScoring } = req.body;

    if (language) user.preferences.language = language;
    if (theme) user.preferences.theme = theme;
    if (outdoorMode !== undefined) user.preferences.outdoorMode = Boolean(outdoorMode);
    if (notifications) {
      user.preferences.notifications = Object.assign({}, user.preferences.notifications || {}, notifications);
    }
    if (privacy) {
      user.preferences.privacy = Object.assign({}, user.preferences.privacy || {}, privacy);
    }
    if (defaultScoring) {
      if (defaultScoring.rules) {
        const val = engine.validateAndNormalizeRules(defaultScoring.rules);
        if (!val.valid) {
          return res.status(400).json({ success: false, message: val.errors.join(' ') });
        }
        defaultScoring.rules = val.rules;
      }
      user.preferences.defaultScoring = Object.assign({}, user.preferences.defaultScoring || {}, defaultScoring);
    }

    user.markModified('preferences');
    await user.save();

    res.json({ success: true, preferences: user.preferences });
  } catch (err) {
    next(err);
  }
}

async function saveCustomRulePreset(req, res, next) {
  try {
    const { name, description, rules, clientId } = req.body;
    if (!name || !rules) {
      return res.status(400).json({ success: false, message: 'Preset name and rules are required.' });
    }

    const validation = engine.validateAndNormalizeRules(rules);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.errors.join(' ') });
    }

    const isGuest = Boolean(req.guest && !req.user);
    const preset = await ScoringRule.create({
      ownerType: isGuest ? 'guest' : 'user',
      guestId: isGuest ? req.guest.guestId : null,
      userId: req.user ? req.user._id : null,
      clientId: clientId || null,
      name: String(name).trim(),
      presetId: (isGuest ? 'guest_' : 'user_') + Date.now(),
      description: description ? String(description).trim() : 'Custom scoring preset',
      isSystemPreset: false,
      createdBy: req.user ? req.user._id : null,
      rules: validation.rules
    });

    res.status(201).json({ success: true, preset });
  } catch (err) {
    next(err);
  }
}

async function deleteCustomRulePreset(req, res, next) {
  try {
    const preset = await ScoringRule.findById(req.params.id);
    if (!preset) return res.status(404).json({ success: false, message: 'Rule preset not found.' });
    if (preset.isSystemPreset) {
      return res.status(403).json({ success: false, message: 'System presets cannot be deleted.' });
    }
    if (req.guest) {
      if (preset.ownerType !== 'guest' || preset.guestId !== req.guest.guestId) {
        return res.status(403).json({ success: false, message: 'Not authorized to delete this preset.' });
      }
    } else if (
      String(preset.createdBy || preset.userId) !== String(req.user._id) &&
      req.user.role !== 'super_admin'
    ) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this preset.' });
    }
    await preset.deleteOne();
    res.json({ success: true, message: 'Custom rule preset deleted.' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSettings,
  updatePreferences,
  saveCustomRulePreset,
  deleteCustomRulePreset
};
