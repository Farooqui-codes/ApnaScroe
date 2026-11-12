const crypto = require('crypto');
const config = require('../config/env');

function isConfigured() {
  return Boolean(config.razorpayKeyId && config.razorpayKeySecret);
}

async function createOrder({ amountPaise, currency = 'INR', receipt, notes = {} }) {
  if (!isConfigured()) {
    const err = new Error('Razorpay keys are not configured on the server. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
    err.status = 503;
    throw err;
  }

  const auth = Buffer.from(`${config.razorpayKeyId}:${config.razorpayKeySecret}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: Math.round(Number(amountPaise)),
      currency,
      receipt: String(receipt).slice(0, 40),
      notes
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.description || 'Failed to create Razorpay order.');
    err.status = 502;
    throw err;
  }
  return data;
}

function timingSafeHexEqual(a, b) {
  if (!a || !b || String(a).length !== String(b).length) return false;
  return crypto.timingSafeEqual(Buffer.from(String(a), 'utf8'), Buffer.from(String(b), 'utf8'));
}

function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!config.razorpayKeySecret || !orderId || !paymentId || !signature) return false;
  const expected = crypto
    .createHmac('sha256', config.razorpayKeySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return timingSafeHexEqual(expected, signature);
}

function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = config.razorpayWebhookSecret || config.razorpayKeySecret;
  if (!secret || !rawBody || !signatureHeader) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return timingSafeHexEqual(expected, signatureHeader);
}

module.exports = {
  isConfigured,
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature
};
