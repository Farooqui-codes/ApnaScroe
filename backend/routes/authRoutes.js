const express = require('express');
const router = express.Router();
const authCtrl = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

router.post('/register', authCtrl.register);
router.post('/login', authCtrl.login);
router.get('/me', authenticate, authCtrl.me);
router.put('/profile', authenticate, authCtrl.updateProfile);
router.put('/password', authenticate, authCtrl.changePassword);
router.post('/avatar', authenticate, uploadImage.single('avatar'), authCtrl.uploadAvatar);

module.exports = router;
