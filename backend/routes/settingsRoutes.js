const express = require('express');
const router = express.Router();
const settingsCtrl = require('../controllers/settingsController');
const { authenticate, optionalAuth } = require('../middleware/auth');

router.get('/', optionalAuth, settingsCtrl.getSettings);
router.put('/preferences', authenticate, settingsCtrl.updatePreferences);
router.post('/presets', authenticate, settingsCtrl.saveCustomRulePreset);
router.delete('/presets/:id', authenticate, settingsCtrl.deleteCustomRulePreset);

module.exports = router;
