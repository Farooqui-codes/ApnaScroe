const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const payCtrl = require('../controllers/paymentController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const payLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many payment requests. Please wait a few minutes.' }
});

router.get('/plans', payCtrl.getPlans);
router.post('/create-order', authenticate, payLimiter, payCtrl.createOrder);
router.post('/verify', authenticate, payLimiter, payCtrl.verifyPayment);
router.post('/mark-failed', authenticate, payCtrl.markPaymentFailed);
router.post('/webhook', payCtrl.handleWebhook);
router.get('/my', authenticate, payCtrl.listMyPayments);
router.get('/:id/invoice', authenticate, payCtrl.downloadInvoice);

router.get('/admin/overview', authenticate, requireRole('super_admin'), payCtrl.adminOverview);
router.post('/admin/grant-pro', authenticate, requireRole('super_admin'), payCtrl.adminGrantPro);

module.exports = router;
