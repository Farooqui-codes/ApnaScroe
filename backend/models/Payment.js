const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', default: null, index: true },
    planId: { type: String, enum: ['per_tournament', 'monthly'], required: true },
    gateway: { type: String, enum: ['razorpay', 'manual_admin'], default: 'razorpay' },
    razorpayOrderId: { type: String, unique: true, sparse: true, index: true },
    razorpayPaymentId: { type: String, default: '', index: true },
    razorpaySignature: { type: String, default: '' },
    amountPaise: { type: Number, required: true, min: 0 },
    amountInr: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    status: {
      type: String,
      enum: ['created', 'paid', 'failed', 'refunded'],
      default: 'created',
      index: true
    },
    receiptNumber: { type: String, required: true, unique: true },
    webhookProcessedAt: { type: Date, default: null },
    failureReason: { type: String, default: '' },
    note: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema, 'payments');
