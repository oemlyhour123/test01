/* ==========================================================================
   RRMS — Application configuration
   --------------------------------------------------------------------------
   Phase 2 runs in demo mode with deterministic sample records plus browser-
   local management changes. To connect Supabase later:
     1. Set demoMode to false.
     2. Fill in supabase.url and supabase.anonKey (NEVER the service-role key).
     3. Run database/schema.sql and database/seed.sql in the Supabase SQL editor.
   ========================================================================== */
(function () {
  'use strict';

  window.RRMS = window.RRMS || {};

  var Config = {
    version: '0.2.0',
    phase: 2,
    demoMode: true,

    supabase: {
      url: '',
      anonKey: '',
      jsUrl: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'
    },

    defaultLanguage: 'km',
    languages: ['km', 'en'],

    currency: 'USD',
    secondaryCurrency: 'KHR',
    usdToKhr: 4100,
    locale: 'en-US',

    invoiceDueDay: 5,
    sessionHours: 12,

    demoCredentials: {
      email: 'admin@rrms.local',
      password: 'rrms2026'
    },

    keys: {
      language: 'rrms.lang',
      session: 'rrms.session',
      sidebar: 'rrms.sidebar.collapsed',
      demoData: 'rrms.demo.v2'
    },

    isSupabaseConfigured: function () {
      return !Config.demoMode &&
        /^https?:\/\//.test(Config.supabase.url) &&
        Config.supabase.anonKey.length > 20;
    },

    appName: function (lang) {
      return lang === 'en'
        ? 'Residential Rental Management'
        : 'ប្រព័ន្ធគ្រប់គ្រងការជួលបន្ទប់';
    }
  };

  RRMS.Config = Config;
})();
