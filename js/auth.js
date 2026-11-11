/**
 * ApnaScore Authentication & Session Helpers
 */
(function (root) {
  'use strict';

  const ROLE_LABELS = {
    super_admin: 'Super Admin',
    organizer: 'Tournament Organizer',
    team_manager: 'Team Manager',
    scorer: 'Official Scorer',
    viewer: 'Viewer'
  };

  function getUser() {
    return root.ApnaAPI.getStoredUser();
  }

  function isLoggedIn() {
    return Boolean(root.ApnaAPI.getToken() && getUser());
  }

  function roleLabel(role) {
    return ROLE_LABELS[role] || 'Scorer';
  }

  function requireAuth(redirectTo = '/login.html') {
    if (!isLoggedIn()) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `${redirectTo}?next=${next}`;
      return false;
    }
    return true;
  }

  function logout() {
    root.ApnaAPI.clearSession();
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
    isLoggedIn,
    roleLabel,
    requireAuth,
    logout,
    refreshUser
  };
}(window));
