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

router.post('/register', authLimiter, authCtrl.register);
router.post('/login', authLimiter, authCtrl.login);
router.get('/me', authenticate, authCtrl.me);
router.put('/profile', authenticate, authCtrl.updateProfile);
router.put('/password', authenticate, authCtrl.changePassword);
router.post('/avatar', authenticate, uploadImage.single('avatar'), authCtrl.uploadAvatar);

module.exports = router;
