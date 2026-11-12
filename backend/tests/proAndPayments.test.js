const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

// Set test Razorpay env vars before loading config/server
process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_apnascore';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret_123456';
process.env.RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_webhook_secret_123';

const { createApp } = require('../server');
const { seedSystemPresets } = require('../utils/seedPresets');
const Payment = require('../models/Payment');
const Tournament = require('../models/Tournament');
const User = require('../models/User');

describe('Tournament Manager Pro & Razorpay Payment Verification (E2E)', () => {
  let mongod;
  let server;
  let baseUrl;

  before(async () => {
    const localTestUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apnascore_pro_e2e_test';
    try {
      await mongoose.connect(localTestUri, { serverSelectionTimeoutMS: 2500 });
      await mongoose.connection.dropDatabase();
    } catch (_) {
      mongod = await MongoMemoryServer.create();
      await mongoose.connect(mongod.getUri());
    }
    await seedSystemPresets();

    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
    if (mongod) await mongod.stop();
  });

  async function api(method, path, body = null, headers = {}) {
    const opts = {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers)
    };
    if (body !== null) opts.body = JSON.stringify(body);
    const res = await fetch(`${baseUrl}${path}`, opts);
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/pdf') ? Buffer.from(await res.arrayBuffer()) : await res.json();
    return { status: res.status, data };
  }

  it('enforces Free limits on server, verifies Razorpay HMAC & webhook idempotently, unlocks Pro features & admin panel', async () => {
    // 1. Register organizer
    const reg = await api('POST', '/api/auth/register', {
      name: 'Pro Organizer',
      email: 'proorg@apnascore.in',
      village: 'Rampur',
      role: 'organizer',
      password: 'password123'
    });
    assert.equal(reg.status, 201);
    const orgHeaders = { Authorization: `Bearer ${reg.data.token}` };

    // 2. Create 5 teams
    const teamIds = [];
    for (let i = 1; i <= 5; i++) {
      const t = await api('POST', '/api/teams', { name: `Pro Team ${i}`, village: 'Rampur' }, orgHeaders);
      assert.equal(t.status, 201);
      teamIds.push(t.data.team._id);
    }

    // 3. Free tournament creation with maxTeams=4 succeeds
    const freeTour = await api('POST', '/api/tournaments', {
      name: 'Rampur Free Cup',
      village: 'Rampur',
      startDate: '2026-12-01',
      endDate: '2026-12-03',
      maxTeams: 4,
      oversPerMatch: 6,
      entryFee: 500,
      format: 'knockout',
      teamIds: teamIds.slice(0, 4)
    }, orgHeaders);
    assert.equal(freeTour.status, 201);
    assert.equal(freeTour.data.tournament.plan, 'free');
    const tourId = freeTour.data.tournament._id;

    // 4. Server blocks 2nd tournament, 5th team, public reg, entry fee tracker & Pro PDF on Free tier
    const secondTour = await api('POST', '/api/tournaments', {
      name: 'Second Free Cup',
      village: 'Rampur',
      startDate: '2026-12-05',
      endDate: '2026-12-06',
      maxTeams: 4,
      format: 'knockout'
    }, orgHeaders);
    assert.equal(secondTour.status, 403);
    assert.equal(secondTour.data.requiresPro, true);

    const fifthTeam = await api('POST', `/api/tournaments/${tourId}/register-team`, { teamId: teamIds[4] }, orgHeaders);
    assert.equal(fifthTeam.status, 403);
    assert.equal(fifthTeam.data.requiresPro, true);

    const freeFee = await api('PUT', `/api/tournaments/${tourId}/entry-fees/${teamIds[0]}`, { feeStatus: 'paid', feeAmountPaid: 500 }, orgHeaders);
    assert.equal(freeFee.status, 403);
    assert.equal(freeFee.data.requiresPro, true);

    const freePubReg = await api('POST', `/api/public/tournaments/${tourId}/register`, {
      teamName: 'Outsider XI',
      captainName: 'Ravi',
      captainPhone: '9876543210'
    });
    assert.equal(freePubReg.status, 403);
    assert.equal(freePubReg.data.requiresPro, true);

    // 5. Simulate Razorpay Order + Signature Verification
    const orderId = 'order_test_9991';
    const payDoc = await Payment.create({
      userId: reg.data.user._id,
      tournamentId: tourId,
      planId: 'per_tournament',
      gateway: 'razorpay',
      razorpayOrderId: orderId,
      amountPaise: 19900,
      amountInr: 199,
      status: 'created',
      receiptNumber: 'INV-TEST-9991'
    });

    // Tampered signature must fail!
    const badVerify = await api('POST', '/api/payments/verify', {
      razorpay_order_id: orderId,
      razorpay_payment_id: 'pay_test_1',
      razorpay_signature: 'invalid_sig_0000'
    }, orgHeaders);
    assert.equal(badVerify.status, 400);

    // Reset status to created and test valid HMAC-SHA256 signature
    payDoc.status = 'created';
    await payDoc.save();
    const paymentId = 'pay_test_valid_1';
    const validSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const goodVerify = await api('POST', '/api/payments/verify', {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: validSig
    }, orgHeaders);
    assert.equal(goodVerify.status, 200);
    assert.equal(goodVerify.data.tournament.plan, 'pro');

    // Invoice PDF downloads cleanly
    const invRes = await api('GET', `/api/payments/${payDoc._id}/invoice`, null, orgHeaders);
    assert.equal(invRes.status, 200);
    assert.ok(invRes.data.slice(0, 5).toString('utf8').startsWith('%PDF-'));

    // Webhook idempotency test
    const whPayload = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: paymentId, order_id: orderId } } }
    });
    const whSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(whPayload)
      .digest('hex');
    const whRes1 = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': whSig },
      body: whPayload
    });
    assert.equal(whRes1.status, 200);
    const whRes2 = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': whSig },
      body: whPayload
    });
    assert.equal(whRes2.status, 200);
    const whJson2 = await whRes2.json();
    assert.equal(whJson2.status, 'already_processed');

    // 6. Pro features now UNLOCKED on the tournament!
    const proFee = await api('PUT', `/api/tournaments/${tourId}/entry-fees/${teamIds[0]}`, {
      feeStatus: 'paid',
      feeAmountPaid: 500,
      paymentMode: 'upi'
    }, orgHeaders);
    assert.equal(proFee.status, 200);
    assert.equal(proFee.data.feeSummary.totalCollected, 500);

    const proPubReg = await api('POST', `/api/public/tournaments/${tourId}/register`, {
      teamName: 'Outsider XI',
      captainName: 'Ravi',
      captainPhone: '9876543210',
      playerNames: 'Ravi, Mohit, Sahil'
    });
    assert.equal(proPubReg.status, 201);

    const fxGen = await api('POST', `/api/tournaments/${tourId}/fixtures/generate`, {}, orgHeaders);
    assert.equal(fxGen.status, 200);
    const fxId = fxGen.data.fixtures[0]._id;

    const fxEdit = await api('PUT', `/api/tournaments/${tourId}/fixtures/${fxId}`, {
      scheduledTime: '10:00 AM',
      venue: 'Main Stadium'
    }, orgHeaders);
    assert.equal(fxEdit.status, 200);
    assert.equal(fxEdit.data.fixture.scheduledTime, '10:00 AM');

    const proPdf = await api('GET', `/api/tournaments/${tourId}/pro-pdf`, null, orgHeaders);
    assert.equal(proPdf.status, 200);
    assert.ok(proPdf.data.slice(0, 5).toString('utf8').startsWith('%PDF-'));

    // 7. Admin console access control & manual grant/revoke
    const nonAdmin = await api('GET', '/api/payments/admin/overview', null, orgHeaders);
    assert.equal(nonAdmin.status, 403);

    await User.findByIdAndUpdate(reg.data.user._id, { role: 'super_admin' });
    const adminLogin = await api('POST', '/api/auth/login', { email: 'proorg@apnascore.in', password: 'password123' });
    const adminHeaders = { Authorization: `Bearer ${adminLogin.data.token}` };

    const adminOv = await api('GET', '/api/payments/admin/overview', null, adminHeaders);
    assert.equal(adminOv.status, 200);
    assert.equal(adminOv.data.summary.totalRevenueInr, 199);

    const revoke = await api('POST', '/api/payments/admin/grant-pro', { tournamentId: tourId, grant: false }, adminHeaders);
    assert.equal(revoke.status, 200);
    assert.equal(revoke.data.tournament.plan, 'free');
  });
});
