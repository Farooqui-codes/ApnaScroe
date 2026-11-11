const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { hashSessionToken, resolveGuestFromRequest, authenticateOrGuest } = require('../middleware/auth');
const { requireRole, canScoreMatch, canManageTeam, requireRegisteredOrGuestScoring } = require('../middleware/rbac');
const GuestSession = require('../models/GuestSession');
const Match = require('../models/Match');
const Team = require('../models/Team');

describe('Guest Session Security, Token Hashing & Isolation Checks', () => {
  it('hashes guest session tokens securely with SHA-256 and validates timing-safely', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const storedHash = hashSessionToken(rawToken);
    assert.notEqual(rawToken, storedHash);
    assert.equal(storedHash.length, 64);

    // Mock GuestSession.findOne to test resolveGuestFromRequest
    const origFindOne = GuestSession.findOne;
    let saved = false;
    GuestSession.findOne = (q) => ({
      select: async () => {
        if (q.guestId !== 'gst_valid_1') return null;
        return {
          guestId: 'gst_valid_1',
          deviceId: 'dev_1',
          sessionTokenHash: storedHash,
          status: 'active',
          expiresAt: new Date(Date.now() + 60000),
          save: async () => { saved = true; }
        };
      }
    });

    try {
      // 1. guestId alone without token MUST return null
      const noToken = await resolveGuestFromRequest({ headers: { 'x-guest-id': 'gst_valid_1' } });
      assert.equal(noToken, null);

      // 2. Wrong token MUST return null
      const badToken = await resolveGuestFromRequest({
        headers: { 'x-guest-id': 'gst_valid_1', 'x-guest-token': 'forged_token_value' }
      });
      assert.equal(badToken, null);

      // 3. Valid guestId + valid token succeeds and updates lastActiveAt
      const valid = await resolveGuestFromRequest({
        headers: { 'x-guest-id': 'gst_valid_1', 'x-guest-token': rawToken }
      });
      assert.ok(valid);
      assert.equal(valid.guestId, 'gst_valid_1');
      assert.equal(saved, true);
    } finally {
      GuestSession.findOne = origFindOne;
    }
  });

  it('rejects expired guest sessions cleanly', async () => {
    const rawToken = 'expired_tok_123';
    const origFindOne = GuestSession.findOne;
    GuestSession.findOne = () => ({
      select: async () => ({
        guestId: 'gst_exp',
        sessionTokenHash: hashSessionToken(rawToken),
        status: 'active',
        expiresAt: new Date(Date.now() - 1000)
      })
    });

    try {
      const res = await resolveGuestFromRequest({
        headers: { 'x-guest-id': 'gst_exp', 'x-guest-token': rawToken }
      });
      assert.equal(res, null);
    } finally {
      GuestSession.findOne = origFindOne;
    }
  });

  it('blocks Guest from tournament creation with requiresAccount: true and allows scoring', () => {
    const tourGuard = requireRole('organizer');
    let statusCode = 0;
    let payload = null;
    let nextCalled = false;

    tourGuard(
      { guest: { guestId: 'gst_1' } },
      { status: (s) => { statusCode = s; return { json: (p) => { payload = p; } }; } },
      () => { nextCalled = true; }
    );
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 401);
    assert.equal(payload.requiresAccount, true);

    // Guest scoring guard allows guest
    let scoringAllowed = false;
    requireRegisteredOrGuestScoring({ guest: { guestId: 'gst_1' } }, {}, () => { scoringAllowed = true; });
    assert.equal(scoringAllowed, true);
  });

  it('prevents Guest B from scoring Guest A match or editing Guest A team (403)', async () => {
    const origMatchFind = Match.findById;
    const origTeamFind = Team.findById;
    Match.findById = async () => ({ _id: 'm1', ownerType: 'guest', guestId: 'gst_A' });
    Team.findById = async () => ({ _id: 't1', ownerType: 'guest', guestId: 'gst_A' });

    try {
      // Guest B on Match A -> 403
      let mStatus = 0;
      let mNext = false;
      await canScoreMatch(
        { guest: { guestId: 'gst_B' }, params: { matchId: 'm1' }, body: {} },
        { status: (s) => { mStatus = s; return { json: () => {} }; } },
        () => { mNext = true; }
      );
      assert.equal(mNext, false);
      assert.equal(mStatus, 403);

      // Guest A on Match A -> allowed
      mNext = false;
      await canScoreMatch(
        { guest: { guestId: 'gst_A' }, params: { matchId: 'm1' }, body: {} },
        {},
        () => { mNext = true; }
      );
      assert.equal(mNext, true);

      // Guest B on Team A -> 403
      let tStatus = 0;
      let tNext = false;
      await canManageTeam(
        { guest: { guestId: 'gst_B' }, params: { id: 't1' } },
        { status: (s) => { tStatus = s; return { json: () => {} }; } },
        () => { tNext = true; }
      );
      assert.equal(tNext, false);
      assert.equal(tStatus, 403);
    } finally {
      Match.findById = origMatchFind;
      Team.findById = origTeamFind;
    }
  });
});
