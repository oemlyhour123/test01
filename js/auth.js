/* ==========================================================================
   RRMS — Authentication adapter
   Phase 1 uses a local demo session (12-hour expiry). If Supabase is
   configured in js/config.js, Supabase Auth is used instead. The service-role
   key must never be shipped to the browser.
   ========================================================================== */
(function () {
  'use strict';

  window.RRMS = window.RRMS || {};
  var Config = RRMS.Config;
  var supabaseClient = null;

  function safeParse(value) {
    try { return JSON.parse(value); } catch (err) { return null; }
  }

  function readSession() {
    try {
      var session = safeParse(window.localStorage.getItem(Config.keys.session));
      if (!session) return null;
      if (!session.expiresAt || session.expiresAt <= Date.now()) {
        window.localStorage.removeItem(Config.keys.session);
        return null;
      }
      return session;
    } catch (err) {
      return null;
    }
  }

  function saveSession(session) {
    try {
      window.localStorage.setItem(Config.keys.session, JSON.stringify(session));
    } catch (err) {
      if (window.console) console.warn('[Auth] Session storage unavailable.');
    }
  }

  function clearSession() {
    try { window.localStorage.removeItem(Config.keys.session); } catch (err) { /* ignore */ }
  }

  function buildDemoSession() {
    return {
      provider: 'demo',
      accessToken: 'demo',
      user: {
        id: 'demo-admin',
        email: Config.demoCredentials.email,
        nameKey: 'user.demoName',
        role: 'admin',
        demo: true
      },
      expiresAt: Date.now() + Config.sessionHours * 60 * 60 * 1000
    };
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-supabase]')) { resolve(); return; }
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.setAttribute('data-supabase', 'true');
      script.onload = resolve;
      script.onerror = function () { reject(new Error('Unable to load Supabase client.')); };
      document.head.appendChild(script);
    });
  }

  async function getClient() {
    if (!Config.isSupabaseConfigured()) throw new Error('Supabase is not configured.');
    if (supabaseClient && window.supabase) return supabaseClient;
    await loadScript(Config.supabase.jsUrl);
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error('Supabase client unavailable.');
    }
    supabaseClient = window.supabase.createClient(Config.supabase.url, Config.supabase.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return supabaseClient;
  }

  async function signInPassword(email, password) {
    if (Config.demoMode) {
      var demo = Config.demoCredentials;
      if (email.trim().toLowerCase() !== demo.email || password !== demo.password) {
        throw new Error('INVALID_CREDENTIALS');
      }
      var session = buildDemoSession();
      saveSession(session);
      return session;
    }

    var client = await getClient();
    var result = await client.auth.signInWithPassword({ email: email, password: password });
    if (result.error) throw new Error('INVALID_CREDENTIALS');
    var user = result.data.user;
    var live = {
      provider: 'supabase',
      accessToken: result.data.session ? result.data.session.access_token : null,
      user: {
        id: user.id,
        email: user.email,
        name: (user.user_metadata && user.user_metadata.full_name) || user.email,
        role: (user.user_metadata && user.user_metadata.role) || 'admin',
        demo: false
      },
      expiresAt: result.data.session && result.data.session.expires_at
        ? result.data.session.expires_at * 1000
        : Date.now() + Config.sessionHours * 60 * 60 * 1000
    };
    saveSession(live);
    return live;
  }

  function signInDemo() {
    var session = buildDemoSession();
    saveSession(session);
    return session;
  }

  async function restoreSupabaseSession() {
    if (!Config.isSupabaseConfigured()) return null;
    try {
      var client = await getClient();
      var result = await client.auth.getSession();
      if (!result.data.session) return null;
      var user = result.data.session.user;
      var live = {
        provider: 'supabase',
        accessToken: result.data.session.access_token,
        user: {
          id: user.id,
          email: user.email,
          name: (user.user_metadata && user.user_metadata.full_name) || user.email,
          role: (user.user_metadata && user.user_metadata.role) || 'admin',
          demo: false
        },
        expiresAt: result.data.session.expires_at
          ? result.data.session.expires_at * 1000
          : Date.now() + Config.sessionHours * 60 * 60 * 1000
      };
      saveSession(live);
      return live;
    } catch (err) {
      return null;
    }
  }

  async function init() {
    var session = readSession();
    if (!session && Config.isSupabaseConfigured()) {
      session = await restoreSupabaseSession();
    }
    return session;
  }

  function getSession() {
    return readSession();
  }

  function requireAuth(loginUrl) {
    var session = getSession();
    if (!session) {
      window.location.replace(loginUrl || '../login.html');
      return null;
    }
    return session;
  }

  async function signOut() {
    if (Config.isSupabaseConfigured()) {
      try {
        var client = await getClient();
        await client.auth.signOut();
      } catch (err) { /* keep local cleanup */ }
    }
    clearSession();
  }

  function displayName(session, t) {
    if (!session || !session.user) return '';
    if (session.user.nameKey) return t(session.user.nameKey);
    return session.user.name || session.user.email || '';
  }

  RRMS.Auth = {
    init: init,
    signIn: signInPassword,
    signInDemo: signInDemo,
    signOut: signOut,
    getSession: getSession,
    requireAuth: requireAuth,
    displayName: displayName,
    isDemo: function () { return Config.demoMode; }
  };
})();
