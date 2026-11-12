const PDFDocument = require('pdfkit');
const Payment = require('../models/Payment');
const Tournament = require('../models/Tournament');
const User = require('../models/User');
const config = require('../config/env');
const { FREE_LIMITS, PRO_PLANS, ACTIVE_PLAN_MODE } = require('../config/plans');
const razorpayService = require('../services/razorpayService');
const { logAudit } = require('../utils/logger');

function makeReceiptNumber() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `INV-${d}-${rand}`;
}

async function unlockProEntitlement(payment) {
  if (payment.planId === 'monthly') {
    const user = await User.findById(payment.userId);
    if (user) {
      const base = user.proExpiresAt && new Date(user.proExpiresAt) > new Date()
        ? new Date(user.proExpiresAt)
        : new Date();
      base.setDate(base.getDate() + (PRO_PLANS.monthly.durationDays || 30));
      user.proExpiresAt = base;
      await user.save();
    }
    if (payment.tournamentId) {
      await Tournament.findByIdAndUpdate(payment.tournamentId, {
        plan: 'pro',
        proUnlockedAt: new Date(),
        proPaymentId: payment._id
      });
    }
  } else if (payment.tournamentId) {
    await Tournament.findByIdAndUpdate(payment.tournamentId, {
      plan: 'pro',
      proUnlockedAt: new Date(),
      proPaymentId: payment._id
    });
  }
}

async function getPlans(_req, res) {
  res.json({
    success: true,
    activeMode: ACTIVE_PLAN_MODE,
    freeLimits: FREE_LIMITS,
    plans: {
      per_tournament: {
        id: PRO_PLANS.per_tournament.id,
        name: PRO_PLANS.per_tournament.name,
        billingType: PRO_PLANS.per_tournament.billingType,
        amountInr: PRO_PLANS.per_tournament.amountInr,
        amountPaise: PRO_PLANS.per_tournament.amountPaise,
        description: PRO_PLANS.per_tournament.description
      },
      monthly: {
        id: PRO_PLANS.monthly.id,
        name: PRO_PLANS.monthly.name,
        billingType: PRO_PLANS.monthly.billingType,
        amountInr: PRO_PLANS.monthly.amountInr,
        amountPaise: PRO_PLANS.monthly.amountPaise,
        durationDays: PRO_PLANS.monthly.durationDays,
        description: PRO_PLANS.monthly.description
      }
    },
    razorpayKeyId: config.razorpayKeyId || '',
    configured: razorpayService.isConfigured()
  });
}

async function createOrder(req, res, next) {
  try {
    const { planId = 'per_tournament', tournamentId = null } = req.body || {};
    const plan = PRO_PLANS[planId];
    if (!plan) {
      return res.status(400).json({ success: false, message: 'Invalid planId.' });
    }
    if (ACTIVE_PLAN_MODE !== 'both' && ACTIVE_PLAN_MODE !== planId) {
      return res.status(400).json({ success: false, message: `Plan "${planId}" is currently disabled.` });
    }

    let tournament = null;
    if (tournamentId) {
      tournament = await Tournament.findById(tournamentId);
      if (!tournament) return res.status(404).json({ success: false, message: 'Tournament not found.' });
      if (req.user.role !== 'super_admin' && String(tournament.organizerId) !== String(req.user._id)) {
        return res.status(403).json({ success: false, message: 'Only the tournament organizer can upgrade this tournament.' });
      }
      if (tournament.plan === 'pro' && planId === 'per_tournament') {
        return res.status(400).json({ success: false, message: 'This tournament is already on Tournament Manager Pro.' });
      }
    } else if (planId === 'per_tournament') {
      return res.status(400).json({ success: false, message: 'Please select a tournament to unlock with the Per-Tournament Pro Pass.' });
    }

    const receiptNumber = makeReceiptNumber();
    const order = await razorpayService.createOrder({
      amountPaise: plan.amountPaise,
      currency: 'INR',
      receipt: receiptNumber,
      notes: {
        userId: String(req.user._id),
        tournamentId: tournament ? String(tournament._id) : '',
        planId
      }
    });

    const payment = await Payment.create({
      userId: req.user._id,
      tournamentId: tournament ? tournament._id : null,
      planId,
      gateway: 'razorpay',
      razorpayOrderId: order.id,
      amountPaise: plan.amountPaise,
      amountInr: plan.amountInr,
      currency: 'INR',
      status: 'created',
      receiptNumber
    });

    res.status(201).json({
      success: true,
      paymentId: payment._id,
      orderId: order.id,
      amountPaise: plan.amountPaise,
      amountInr: plan.amountInr,
      currency: 'INR',
      keyId: config.razorpayKeyId,
      receiptNumber,
      planName: plan.name,
      tournamentName: tournament ? tournament.name : 'Organizer Monthly Pro'
    });
  } catch (err) {
    next(err);
  }
}

async function verifyPayment(req, res, next) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing Razorpay payment verification fields.' });
    }

    const payment = await Payment.findOne({ razorpayOrderId: String(razorpay_order_id) });
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment order not found.' });
    }
    if (req.user.role !== 'super_admin' && String(payment.userId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Unauthorized payment verification.' });
    }

    if (payment.status === 'paid') {
      const tournament = payment.tournamentId ? await Tournament.findById(payment.tournamentId).lean() : null;
      return res.json({ success: true, alreadyVerified: true, payment, tournament });
    }

    const valid = razorpayService.verifyPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature
    });

    if (!valid) {
      payment.status = 'failed';
      payment.failureReason = 'Invalid Razorpay signature';
      await payment.save();
      return res.status(400).json({ success: false, message: 'Payment signature verification failed.' });
    }

    payment.status = 'paid';
    payment.razorpayPaymentId = String(razorpay_payment_id);
    payment.razorpaySignature = String(razorpay_signature);
    await payment.save();

    await unlockProEntitlement(payment);
    await logAudit({
      req,
      action: 'PRO_PAYMENT_VERIFIED',
      entityType: 'Payment',
      entityId: payment._id,
      details: { planId: payment.planId, amountInr: payment.amountInr, tournamentId: payment.tournamentId }
    });

    const tournament = payment.tournamentId ? await Tournament.findById(payment.tournamentId).lean() : null;
    res.json({ success: true, payment, tournament, invoiceUrl: `/api/payments/${payment._id}/invoice` });
  } catch (err) {
    next(err);
  }
}

async function markPaymentFailed(req, res, next) {
  try {
    const { razorpay_order_id, reason } = req.body || {};
    if (!razorpay_order_id) return res.status(400).json({ success: false, message: 'razorpay_order_id is required.' });
    const payment = await Payment.findOne({ razorpayOrderId: String(razorpay_order_id), userId: req.user._id });
    if (!payment) return res.status(404).json({ success: false, message: 'Order not found.' });
    if (payment.status === 'created') {
      payment.status = 'failed';
      payment.failureReason = String(reason || 'Payment cancelled or failed').slice(0, 240);
      await payment.save();
    }
    res.json({ success: true, payment });
  } catch (err) {
    next(err);
  }
}

async function handleWebhook(req, res, next) {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    if (!razorpayService.verifyWebhookSignature(rawBody, signature)) {
      return res.status(400).json({ success: false, message: 'Invalid webhook signature.' });
    }

    const event = req.body || {};
    const eventType = event.event || '';
    const payEntity = event.payload?.payment?.entity || {};
    const orderId = payEntity.order_id || event.payload?.order?.entity?.id;
    if (!orderId) return res.json({ status: 'ignored' });

    const payment = await Payment.findOne({ razorpayOrderId: String(orderId) });
    if (!payment) return res.json({ status: 'order_not_found' });

    // Idempotency: skip if already paid and webhook processed
    if (payment.status === 'paid' && payment.webhookProcessedAt) {
      return res.json({ status: 'already_processed' });
    }

    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      payment.status = 'paid';
      payment.razorpayPaymentId = payEntity.id || payment.razorpayPaymentId;
      payment.webhookProcessedAt = new Date();
      await payment.save();
      await unlockProEntitlement(payment);
    } else if (eventType === 'payment.failed' && payment.status !== 'paid') {
      payment.status = 'failed';
      payment.failureReason = payEntity.error_description || 'Webhook reported payment failure';
      payment.webhookProcessedAt = new Date();
      await payment.save();
    }

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
}

async function listMyPayments(req, res, next) {
  try {
    const payments = await Payment.find({ userId: req.user._id })
      .populate('tournamentId', 'name village plan')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, payments });
  } catch (err) {
    next(err);
  }
}

async function downloadInvoice(req, res, next) {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('userId', 'name email village')
      .populate('tournamentId', 'name village');
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });

    if (req.user.role !== 'super_admin' && String(payment.userId._id) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const doc = new PDFDocument({ margin: 45, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
      const buf = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="ApnaScore_Receipt_${payment.receiptNumber}.pdf"`);
      res.send(buf);
    });

    doc.rect(0, 0, doc.page.width, 74).fill('#208B4E');
    doc.fillColor('#FFFFFF').fontSize(20).font('Helvetica-Bold').text('ApnaScore', 45, 22);
    doc.fontSize(10).font('Helvetica').text('Tournament Manager Pro — Payment Receipt / Invoice', 45, 46);

    doc.fillColor('#0F3822').fontSize(12).font('Helvetica-Bold').text(`Receipt #: ${payment.receiptNumber}`, 45, 100);
    doc.font('Helvetica').fontSize(10)
      .text(`Date: ${new Date(payment.createdAt).toLocaleString('en-IN')}`, 45, 120)
      .text(`Status: ${payment.status.toUpperCase()}`, 45, 136)
      .text(`Customer: ${payment.userId?.name || ''} (${payment.userId?.email || ''})`, 45, 152)
      .text(`Plan: ${PRO_PLANS[payment.planId]?.name || payment.planId}`, 45, 168)
      .text(`Tournament: ${payment.tournamentId?.name || 'All Organizer Tournaments (Monthly)'}`, 45, 184)
      .text(`Order ID: ${payment.razorpayOrderId || '-'}`, 45, 200)
      .text(`Payment ID: ${payment.razorpayPaymentId || '-'}`, 45, 216);

    doc.moveTo(45, 245).lineTo(550, 245).stroke('#C3DDC8');
    doc.font('Helvetica-Bold').fontSize(14).text(`Total Paid: INR ${payment.amountInr}.00`, 45, 260);
    doc.font('Helvetica').fontSize(9).fillColor('#4E7861')
      .text('Thank you for choosing ApnaScore Tournament Manager Pro.', 45, 305);
    doc.end();
  } catch (err) {
    next(err);
  }
}

async function adminOverview(req, res, next) {
  try {
    const [payments, tournaments] = await Promise.all([
      Payment.find()
        .populate('userId', 'name email')
        .populate('tournamentId', 'name village plan')
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      Tournament.find()
        .populate('organizerId', 'name email')
        .select('name village plan maxTeams status registeredTeams proUnlockedAt createdAt')
        .sort({ createdAt: -1 })
        .limit(100)
        .lean()
    ]);

    const paid = payments.filter((p) => p.status === 'paid');
    const totalRevenueInr = paid.reduce((sum, p) => sum + Number(p.amountInr || 0), 0);

    res.json({
      success: true,
      summary: {
        totalRevenueInr,
        paidCount: paid.length,
        failedCount: payments.filter((p) => p.status === 'failed').length,
        proTournamentsCount: tournaments.filter((t) => t.plan === 'pro').length
      },
      payments,
      tournaments
    });
  } catch (err) {
    next(err);
  }
}

async function adminGrantPro(req, res, next) {
  try {
    const { tournamentId, grant = true, note = '' } = req.body || {};
    if (!tournamentId) return res.status(400).json({ success: false, message: 'tournamentId is required.' });
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) return res.status(404).json({ success: false, message: 'Tournament not found.' });

    if (grant) {
      const payment = await Payment.create({
        userId: tournament.organizerId,
        tournamentId: tournament._id,
        planId: 'per_tournament',
        gateway: 'manual_admin',
        amountPaise: 0,
        amountInr: 0,
        status: 'paid',
        receiptNumber: makeReceiptNumber(),
        note: String(note || 'Granted manually by admin').slice(0, 200)
      });
      tournament.plan = 'pro';
      tournament.proUnlockedAt = new Date();
      tournament.proPaymentId = payment._id;
    } else {
      tournament.plan = 'free';
      tournament.proUnlockedAt = null;
    }
    await tournament.save();
    await logAudit({
      req,
      action: grant ? 'ADMIN_GRANT_PRO' : 'ADMIN_REVOKE_PRO',
      entityType: 'Tournament',
      entityId: tournament._id,
      details: { note }
    });
    res.json({ success: true, tournament });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getPlans,
  createOrder,
  verifyPayment,
  markPaymentFailed,
  handleWebhook,
  listMyPayments,
  downloadInvoice,
  adminOverview,
  adminGrantPro
};
