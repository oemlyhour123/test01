/* ==========================================================================
   RRMS — Login page controller
   ========================================================================== */
(function () {
  'use strict';

  var I18n, Auth, UI, Icons, Config;

  function t(key, params) { return I18n.t(key, params); }

  function setError(message) {
    var error = document.getElementById('formError');
    if (!error) return;
    if (message) {
      error.textContent = message;
      error.hidden = false;
    } else {
      error.hidden = true;
      error.textContent = '';
    }
  }

  function setLoading(loading) {
    var button = document.getElementById('submitButton');
    if (!button) return;
    button.disabled = loading;
    button.classList.toggle('is-loading', loading);
    var label = button.querySelector('.button-label');
    if (label) label.textContent = loading ? t('login.signingIn') : t('login.signIn');
  }

  function goDashboard() {
    window.location.replace('pages/dashboard.html');
  }

  function updatePasswordToggle() {
    var input = document.getElementById('password');
    var button = document.getElementById('togglePassword');
    if (!input || !button) return;
    var visible = input.type === 'text';
    button.setAttribute('aria-label', visible ? t('login.hidePassword') : t('login.showPassword'));
    button.innerHTML = Icons.svg(visible ? 'eyeOff' : 'eye', 20);
  }

  function updateLanguageButtons() {
    var lang = I18n.getLanguage();
    document.querySelectorAll('[data-lang-inline]').forEach(function (button) {
      button.classList.toggle('is-active', button.getAttribute('data-lang-inline') === lang);
    });
    document.title = t('login.documentTitle');
    updatePasswordToggle();
    var label = document.querySelector('#submitButton .button-label');
    if (label) label.textContent = t('login.signIn');
  }

  function init() {
    I18n = RRMS.I18n;
    Auth = RRMS.Auth;
    UI = RRMS.UI;
    Icons = RRMS.Icons;
    Config = RRMS.Config;

    I18n.init();
    Icons.hydrate(document);
    document.title = t('login.documentTitle');
    updateLanguageButtons();

    if (Auth.getSession()) {
      goDashboard();
      return;
    }

    var form = document.getElementById('loginForm');
    var email = document.getElementById('email');
    var password = document.getElementById('password');
    var demoBox = document.getElementById('demoBox');

    if (!Config.demoMode && demoBox) demoBox.hidden = true;

    document.querySelectorAll('[data-lang-inline]').forEach(function (button) {
      button.addEventListener('click', function () {
        I18n.setLanguage(button.getAttribute('data-lang-inline'));
        I18n.apply(document);
        updateLanguageButtons();
      });
    });

    var toggle = document.getElementById('togglePassword');
    if (toggle) {
      toggle.addEventListener('click', function () {
        if (!password) return;
        password.type = password.type === 'password' ? 'text' : 'password';
        updatePasswordToggle();
      });
    }

    var demoFill = document.getElementById('demoFill');
    if (demoFill) {
      demoFill.addEventListener('click', function () {
        if (email) email.value = Config.demoCredentials.email;
        if (password) password.value = Config.demoCredentials.password;
        setError('');
        if (email) email.focus();
      });
    }

    var demoLogin = document.getElementById('demoLogin');
    if (demoLogin) {
      demoLogin.addEventListener('click', function () {
        Auth.signInDemo();
        goDashboard();
      });
    }

    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        setError('');
        var emailValue = email ? email.value.trim() : '';
        var passwordValue = password ? password.value : '';
        if (!emailValue || !passwordValue) {
          setError(t('login.required'));
          if (email && !emailValue) email.focus();
          else if (password) password.focus();
          return;
        }
        setLoading(true);
        Auth.signIn(emailValue, passwordValue).then(function () {
          goDashboard();
        }).catch(function (err) {
          setLoading(false);
          if (err && err.message === 'INVALID_CREDENTIALS') {
            setError(t('login.invalid'));
          } else {
            setError(t('common.error'));
          }
          if (password) {
            password.focus();
            password.select();
          }
        });
      });
    }

    if (email) email.focus();

    document.addEventListener('rrms:language', function () {
      updateLanguageButtons();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
