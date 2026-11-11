/**
 * ApnaScore API Client – Centralized Fetch Wrapper with JWT & Offline Handling
 */
(function (root) {
  'use strict';

  const TOKEN_KEY = 'apnascore_token';
  const USER_KEY = 'apnascore_user';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function setSession(token, user) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function getStoredUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  async function request(path, options = {}) {
    const headers = Object.assign({}, options.headers || {});
    const token = getToken();
    if (token && !headers.Authorization) {
      headers.Authorization = `Bearer ${token}`;
    }
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (!isFormData && options.body && typeof options.body === 'object' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    let response;
    try {
      response = await fetch(path, Object.assign({}, options, { headers }));
    } catch (networkErr) {
      const err = new Error('Network unavailable. Working in offline mode.');
      err.isOffline = true;
      throw err;
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/pdf')) {
      if (!response.ok) throw new Error('Failed to generate PDF');
      return await response.blob();
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = data.message || `Request failed (${response.status})`;
      const err = new Error(msg);
      err.status = response.status;
      err.data = data;
      if (response.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/register')) {
        clearSession();
      }
      throw err;
    }

    return data;
  }

  root.ApnaAPI = {
    getToken,
    setSession,
    clearSession,
    getStoredUser,
    get: (p) => request(p, { method: 'GET' }),
    post: (p, body) => request(p, { method: 'POST', body }),
    put: (p, body) => request(p, { method: 'PUT', body }),
    del: (p) => request(p, { method: 'DELETE' }),
    upload: (p, formData) => request(p, { method: 'POST', body: formData })
  };
}(window));
