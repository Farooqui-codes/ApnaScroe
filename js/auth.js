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

  function ensureGuestSessionSilently() {
    if (isLoggedIn() || isGuest()) return;
    const deviceId = root.ApnaOffline ? root.ApnaOffline.getDeviceId() : ('dev_' + Date.now());
    const profile = {
      id: 'current',
      guestId: 'gst_local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      deviceId,
      guestToken: 'gtok_local_' + Math.random().toString(36).slice(2, 16),
      migrationStatus: 'pending',
      needsServerSession: true,
      createdAt: new Date().toISOString()
    };
    root.ApnaAPI.setGuestSession(profile);
    if (root.ApnaOffline) {
      root.ApnaOffline.saveGuestProfile(profile).catch(() => {});
    }
    if (navigator.onLine) {
      root.ApnaAPI.post('/api/guest/session', { deviceId }).then((res) => {
        if (res && res.guestId && res.guestToken) {
          profile.guestId = res.guestId;
          profile.guestToken = res.guestToken;
          profile.needsServerSession = false;
          root.ApnaAPI.setGuestSession(profile);
          if (root.ApnaOffline) root.ApnaOffline.saveGuestProfile(profile).catch(() => {});
        }
      }).catch(() => {});
    }
  }

  // Auto-initialize guest mode silently on load so user is never prompted to login or choose guest mode
  try {
    ensureGuestSessionSilently();
  } catch (_) {}

  async function continueAsGuest(redirectUrl = '/dashboard.html') {
    ensureGuestSessionSilently();
    const existing = getGuestSession();
    if (redirectUrl && window.location.pathname !== redirectUrl) {
      window.location.href = redirectUrl;
    }
    return existing;
  }

  function requireAuth(redirectTo = '/login.html', { allowGuest = true } = {}) {
    ensureGuestSessionSilently();
    // Auto guest mode ensures all features are 100% accessible to every user without forced login
    return true;
  }

  async function signInWithGoogle(googleData = {}) {
    const email = googleData.email || prompt('Enter your Google email to sync & backup matches:');
    if (!email) return null;
    const name = googleData.name || email.split('@')[0];
    const avatarUrl = googleData.avatarUrl || '';
    const googleId = googleData.googleId || ('gid_' + Date.now());

    try {
      const res = await root.ApnaAPI.post('/api/auth/google', { email, name, avatarUrl, googleId });
      if (res && res.token && res.user) {
        root.ApnaAPI.setSession(res.token, res.user);
        // Automatically migrate guest data to the Google account
        if (root.ApnaMigrate?.runQueuedOfflineMigration) {
          await root.ApnaMigrate.runQueuedOfflineMigration().catch(() => {});
        }
        if (root.ApnaUI?.showToast) {
          root.ApnaUI.showToast(`Signed in as ${res.user.name}! Your matches are synced to cloud.`);
        }
        return res.user;
      }
    } catch (err) {
      if (root.ApnaUI?.showToast) root.ApnaUI.showToast(err.message || 'Google sign-in failed', 'error');
      throw err;
    }
    return null;
  }

  function logout() {
    root.ApnaAPI.clearSession();
    ensureGuestSessionSilently();
    window.location.href = '/dashboard.html';
  }

  function exitGuestMode() {
    root.ApnaAPI.clearGuestSession();
    ensureGuestSessionSilently();
    window.location.href = '/dashboard.html';
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
    ensureGuestSessionSilently,
    continueAsGuest,
    requireAuth,
    signInWithGoogle,
    logout,
    exitGuestMode,
    refreshUser
  };
}(window));
