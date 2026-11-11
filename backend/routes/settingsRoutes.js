const express = require('express');
const router = express.Router();
const settingsCtrl = require('../controllers/settingsController');
const { authenticate, authenticateOrGuest, optionalAuth } = require('../middleware/auth');

router.get('/', optionalAuth, settingsCtrl.getSettings);
router.put('/preferences', authenticate, settingsCtrl.updatePreferences);
router.post('/presets', authenticateOrGuest, settingsCtrl.saveCustomRulePreset);
router.delete('/presets/:id', authenticateOrGuest, settingsCtrl.deleteCustomRulePreset);

module.exports = router;
