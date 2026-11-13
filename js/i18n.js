/* ==========================================================================
   RRMS — I18n runtime
   Default language is Khmer. The choice is stored as a non-sensitive UI
   preference in localStorage. Every visible label goes through this module.
   ========================================================================== */
(function () {
  'use strict';

  window.RRMS = window.RRMS || {};

  var Config = RRMS.Config;
  var dictionary = RRMS.Translations;
  var current = Config.defaultLanguage;
  var warned = {};

  function readStoredLanguage() {
    try {
      var value = window.localStorage.getItem(Config.keys.language);
      if (Config.languages.indexOf(value) !== -1) return value;
    } catch (err) { /* storage can be unavailable */ }
    return Config.defaultLanguage;
  }

  function persistLanguage(lang) {
    try { window.localStorage.setItem(Config.keys.language, lang); } catch (err) { /* ignore */ }
  }

  function t(key, params) {
    var entry = dictionary[key];
    var text;
    if (!entry) {
      if (!warned[key]) {
        warned[key] = true;
        if (window.console) console.warn('[i18n] Missing translation key:', key);
      }
      return key;
    }
    text = entry[current] || entry.km || key;
    if (params) {
      Object.keys(params).forEach(function (name) {
        text = text.split('{' + name + '}').join(String(params[name]));
      });
    }
    return text;
  }

  function apply(root) {
    var scope = root || document;
    var lang = current;

    scope.querySelectorAll('[data-i18n]').forEach(function (node) {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach(function (node) {
      node.setAttribute('placeholder', t(node.getAttribute('data-i18n-placeholder')));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach(function (node) {
      node.setAttribute('title', t(node.getAttribute('data-i18n-title')));
    });
    scope.querySelectorAll('[data-i18n-aria-label]').forEach(function (node) {
      node.setAttribute('aria-label', t(node.getAttribute('data-i18n-aria-label')));
    });

    document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'km');
    document.documentElement.setAttribute('data-lang', lang);
  }

  function setLanguage(lang) {
    if (Config.languages.indexOf(lang) === -1 || lang === current) return current;
    current = lang;
    persistLanguage(lang);
    apply(document);
    document.dispatchEvent(new CustomEvent('rrms:language', { detail: { lang: lang } }));
    return current;
  }

  function toggleLanguage() {
    return setLanguage(current === 'km' ? 'en' : 'km');
  }

  RRMS.I18n = {
    init: function () {
      current = readStoredLanguage();
      apply(document);
    },
    getLanguage: function () { return current; },
    isKhmer: function () { return current === 'km'; },
    setLanguage: setLanguage,
    toggleLanguage: toggleLanguage,
    t: t,
    apply: apply
  };
})();
