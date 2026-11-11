/**
 * ApnaScore Authentication, Guest Session & Role Helpers
 */
(function (root) {
  'use strict';

  const ROLE_LABELS = {
    super_admin: 'Super Admin',
    organizer: 'Tournament Organizer',
    team_manager: 'Team Manager',
    scorer: 'Official Scorer',
    viewer: 'Viewer',
    guest: 'Guest Scorer'
  };

  function getUser() {
    return root.ApnaAPI.getStoredUser();
  }

  function getGuestSession() {
    return root.ApnaAPI.getGuestSession();
  }

  function isLoggedIn() {
    return Boolean(root.ApnaAPI.getToken() && getUser());
  }

  function isGuest() {
    return !isLoggedIn() && Boolean(getGuestSession() && getGuestSession().guestId);
  }

  function isAuthenticatedOrGuest() {
    return isLoggedIn() || isGuest();
  }

  function roleLabel(role) {
    return ROLE_LABELS[role] || 'Scorer';
  }

  async function continueAsGuest(redirectUrl = '/dashboard.html') {
    const deviceId = root.ApnaOffline ? root.ApnaOffline.getDeviceId() : ('dev_' + Date.now());
    const existing = getGuestSession();
    if (existing && existing.guestId && existing.guestToken) {
      if (redirectUrl) window.location.href = redirectUrl;
      return existing;
    }

    let profile;
    try {
      const res = await root.ApnaAPI.post('/api/guest/session', { deviceId });
      profile = {
        id: 'current',
        guestId: res.guestId,
        deviceId: res.deviceId || deviceId,
        guestToken: res.guestToken,
        expiresAt: res.expiresAt,
        migrationStatus: res.migrationStatus || 'pending',
        needsServerSession: false,
        createdAt: new Date().toISOString()
      };
    } catch (_) {
      // Offline guest entry: create local guest session immediately and queue backend registration
      profile = {
        id: 'current',
        guestId: 'gst_local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        deviceId,
        guestToken: 'gtok_local_' + Math.random().toString(36).slice(2, 16),
        migrationStatus: 'pending',
        needsServerSession: true,
        createdAt: new Date().toISOString()
      };
    }

    if (root.ApnaOffline) {
      await root.ApnaOffline.saveGuestProfile(profile);
    } else {
      root.ApnaAPI.setGuestSession(profile);
    }

    if (redirectUrl) window.location.href = redirectUrl;
    return profile;
  }

  function requireAuth(redirectTo = '/login.html', { allowGuest = false } = {}) {
    if (isLoggedIn()) return true;
    if (allowGuest && isGuest()) return true;
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `${redirectTo}?next=${next}`;
    return false;
  }

  function logout() {
    root.ApnaAPI.clearSession();
    window.location.href = '/login.html';
  }

  function exitGuestMode() {
    root.ApnaAPI.clearGuestSession();
    window.location.href = '/login.html';
  }

  async function refreshUser() {
    if (!root.ApnaAPI.getToken()) return null;
    try {
      const res = await root.ApnaAPI.get('/api/auth/me');
      if (res && res.user) {
        root.ApnaAPI.setSession(root.ApnaAPI.getToken(), res.user);
        return res.user;
      }
    } catch (_) {
      // Keep stored user if offline
    }
    return getUser();
  }

  root.ApnaAuth = {
    getUser,
    getGuestSession,
    isLoggedIn,
    isGuest,
    isAuthenticatedOrGuest,
    roleLabel,
    continueAsGuest,
    requireAuth,
    logout,
    exitGuestMode,
    refreshUser
  };
}(window));
