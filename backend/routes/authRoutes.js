const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const authCtrl = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts. Please try again in 15 minutes.' }
});

const profileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many profile updates. Please wait a few minutes.' }
});

router.post('/register', authLimiter, authCtrl.register);
router.post('/login', authLimiter, authCtrl.login);
router.get('/me', authenticate, authCtrl.me);
router.get('/username-available', authenticate, authCtrl.checkUsername);
router.put('/profile', authenticate, profileLimiter, authCtrl.updateProfile);
router.put('/password', authenticate, authCtrl.changePassword);
router.post('/avatar', authenticate, profileLimiter, uploadImage.single('avatar'), authCtrl.uploadAvatar);
router.delete('/avatar', authenticate, profileLimiter, authCtrl.removeAvatar);
router.post('/org-logo', authenticate, profileLimiter, uploadImage.single('logo'), authCtrl.uploadOrgLogo);
router.get('/profile-stats', authenticate, authCtrl.getProfileStats);
router.post('/link-player', authenticate, profileLimiter, authCtrl.linkPlayer);
router.get('/export-data', authenticate, authCtrl.exportMyData);
router.delete('/account', authenticate, authCtrl.deleteMyAccount);

module.exports = router;
