/* ==========================================================================
   RRMS — Application shell controller
   Sidebar, topbar, global search, notifications, language switch, quick
   actions and the mobile navigation. Page modules live in their own files.
   ========================================================================== */
(function () {
  'use strict';

  window.RRMS = window.RRMS || {};
  var I18n, UI, Store, Auth, Icons, F;

  var MODULE_PHASES = {
    locations: 2,
    rooms: 2,
    tenants: 2,
    meterReadings: 3,
    invoices: 5,
    payments: 5,
    reports: 6,
    settings: 7
  };

  var readNotifications = {};
  var session = null;

  function t(key, params) { return I18n.t(key, params); }

  function langPick(km, en) {
    return I18n.getLanguage() === 'en' ? en : km;
  }

  function phaseLabel(phase) {
    return t('comingSoon.phaseLabel', { phase: phase });
  }

  function roadmapBody(moduleKey) {
    var targetPhase = MODULE_PHASES[moduleKey] || 7;
    var rows = [1, 2, 3, 4, 5, 6, 7].map(function (phase) {
      var state = phase === 1 ? 'done' : phase === targetPhase ? 'target' : '';
      var badge = phase === 1
        ? '<span class="roadmap-state is-done">' + UI.esc(t('comingSoon.current')) + '</span>'
        : phase === targetPhase
          ? '<span class="roadmap-state is-target">' + UI.esc(phaseLabel(phase)) + '</span>'
          : '';
      return '<div class="roadmap-row ' + state + '">' +
        '<span class="roadmap-num">' + phase + '</span>' +
        '<div class="roadmap-copy"><strong>' + UI.esc(t('phase.' + phase)) + '</strong>' +
        '<small>' + UI.esc(phaseLabel(phase)) + '</small></div>' +
        badge +
        '</div>';
    }).join('');

    return '<p class="modal-lead">' + UI.esc(t('comingSoon.body', {
      module: t('nav.' + moduleKey),
      phase: targetPhase
    })) + '</p>' +
      '<h3 class="modal-section-title">' + UI.esc(t('comingSoon.roadmap')) + '</h3>' +
      '<div class="roadmap">' + rows + '</div>';
  }

  function openComingSoon(moduleKey) {
    UI.modal({
      title: t('comingSoon.title'),
      kicker: t('nav.' + moduleKey),
      body: roadmapBody(moduleKey),
      size: 'sm',
      footer: '<button type="button" class="button button-primary" data-close-modal>' +
        UI.esc(t('comingSoon.understood')) + '</button>'
    });
    var close = document.querySelector('.modal-footer [data-close-modal]');
    if (close) close.addEventListener('click', UI.closeModal);
  }

  function openDemoModal() {
    var list = ['demo.list1', 'demo.list2', 'demo.list3', 'demo.list4'].map(function (key) {
      return '<li><span class="check-icon">' + Icons.svg('check', 16) + '</span><span>' +
        UI.esc(t(key)) + '</span></li>';
    }).join('');

    UI.modal({
      title: t('demo.title'),
      kicker: 'RRMS • ' + phaseLabel(RRMS.Config.phase),
      body: '<div class="demo-modal-badge">' + Icons.svg('info', 18) + '<span>' +
          UI.esc(t('topbar.demoPill')) + '</span></div>' +
        '<p class="modal-lead">' + UI.esc(t('demo.body')) + '</p>' +
        '<ul class="check-list">' + list + '</ul>' +
        '<p class="modal-note">' + UI.esc(t('demo.note')) + '</p>',
      footer: '<button type="button" class="button button-primary" data-close-modal>' +
        UI.esc(t('comingSoon.understood')) + '</button>'
    });
    var close = document.querySelector('.modal-footer [data-close-modal]');
    if (close) close.addEventListener('click', UI.closeModal);
  }

  function openMoreSheet() {
    var moduleRows = ['locations', 'meterReadings', 'payments', 'reports', 'settings'].map(function (key) {
      var icons = {
        locations: 'building', meterReadings: 'gauge', payments: 'wallet',
        reports: 'chart', settings: 'settings'
      };
      return '<button type="button" class="action-row" data-more-nav="' + key + '">' +
        '<span class="action-icon">' + Icons.svg(icons[key], 20) + '</span>' +
        '<span class="action-copy"><strong>' + UI.esc(t('nav.' + key)) + '</strong>' +
        '<small>' + UI.esc(phaseLabel(MODULE_PHASES[key])) + '</small></span>' +
        '<span class="action-tail">' + Icons.svg('chevronRight', 18) + '</span>' +
        '</button>';
    }).join('');

    var lang = I18n.getLanguage();
    var body =
      '<div class="sheet-section">' +
        '<p class="sheet-label">' + UI.esc(t('more.modules')) + '</p>' +
        '<div class="action-list">' + moduleRows + '</div>' +
      '</div>' +
      '<div class="sheet-section">' +
        '<p class="sheet-label">' + UI.esc(t('more.preferences')) + '</p>' +
        '<div class="lang-segment lang-segment-wide" role="group" aria-label="' + UI.esc(t('nav.language')) + '">' +
          '<button type="button" data-set-lang="km" class="' + (lang === 'km' ? 'is-active' : '') + '">' +
            UI.esc(t('lang.km')) + '</button>' +
          '<button type="button" data-set-lang="en" class="' + (lang === 'en' ? 'is-active' : '') + '">' +
            UI.esc(t('lang.en')) + '</button>' +
        '</div>' +
        '<button type="button" class="action-row" data-more-about="true">' +
          '<span class="action-icon">' + Icons.svg('info', 20) + '</span>' +
          '<span class="action-copy"><strong>' + UI.esc(t('more.about')) + '</strong>' +
          '<small>' + UI.esc(t('more.demoNote')) + '</small></span>' +
          '<span class="action-tail">' + Icons.svg('chevronRight', 18) + '</span>' +
        '</button>' +
        '<button type="button" class="action-row action-danger" data-more-signout="true">' +
          '<span class="action-icon">' + Icons.svg('logout', 20) + '</span>' +
          '<span class="action-copy"><strong>' + UI.esc(t('nav.logout')) + '</strong>' +
          '<small>' + UI.esc(session && session.user ? session.user.email : '') + '</small></span>' +
          '<span class="action-tail">' + Icons.svg('chevronRight', 18) + '</span>' +
        '</button>' +
      '</div>' +
      '<p class="sheet-note">' + UI.esc(t('more.demoNote')) + '</p>';

    var handle = UI.modal({
      title: t('more.title'),
      subtitle: t('more.account'),
      body: body,
      variant: 'sheet',
      size: 'sm'
    });

    handle.dialog.querySelectorAll('[data-more-nav]').forEach(function (button) {
      button.addEventListener('click', function () {
        var key = button.getAttribute('data-more-nav');
        UI.closeModal();
        window.setTimeout(function () {
          if (RRMS.Manager) RRMS.Manager.navigate(key);
          else openComingSoon(key);
        }, 180);
      });
    });
    handle.dialog.querySelectorAll('[data-set-lang]').forEach(function (button) {
      button.addEventListener('click', function () {
        var langValue = button.getAttribute('data-set-lang');
        UI.closeModal();
        window.setTimeout(function () { switchLanguage(langValue); }, 180);
      });
    });
    var about = handle.dialog.querySelector('[data-more-about]');
    if (about) {
      about.addEventListener('click', function () {
        UI.closeModal();
        window.setTimeout(openDemoModal, 180);
      });
    }
    var signout = handle.dialog.querySelector('[data-more-signout]');
    if (signout) {
      signout.addEventListener('click', function () {
        UI.closeModal();
        window.setTimeout(signOut, 180);
      });
    }
  }

  function openQuickActions() {
    var actions = [
      { key: 'addTenant', module: 'tenants', icon: 'userPlus' },
      { key: 'addRoom', module: 'rooms', icon: 'door' },
      { key: 'recordReading', module: 'meterReadings', icon: 'gauge' },
      { key: 'createInvoice', module: 'invoices', icon: 'receipt' }
    ];
    var body = '<div class="action-list">' + actions.map(function (action) {
      return '<button type="button" class="action-row" data-fab-action="' + action.module + '">' +
        '<span class="action-icon">' + Icons.svg(action.icon, 20) + '</span>' +
        '<span class="action-copy"><strong>' + UI.esc(t('fab.' + action.key)) + '</strong>' +
        '<small>' + UI.esc(phaseLabel(MODULE_PHASES[action.module])) + '</small></span>' +
        '<span class="action-tail">' + Icons.svg('chevronRight', 18) + '</span>' +
        '</button>';
    }).join('') + '</div>';

    var handle = UI.modal({
      title: t('fab.title'),
      subtitle: t('app.tagline'),
      body: body,
      variant: 'sheet',
      size: 'sm'
    });
    handle.dialog.querySelectorAll('[data-fab-action]').forEach(function (button) {
      button.addEventListener('click', function () {
        var module = button.getAttribute('data-fab-action');
        UI.closeModal();
        window.setTimeout(function () {
          if (RRMS.Manager) RRMS.Manager.openCreate(module);
          else openComingSoon(module);
        }, 180);
      });
    });
  }

  function openEntity(type, id) {
    if (RRMS.Manager && RRMS.Manager.isModuleActive()) {
      RRMS.Manager.openEntity(type, id);
      return;
    }
    if (type === 'invoice') {
      document.dispatchEvent(new CustomEvent('rrms:open-invoice', { detail: { id: id } }));
    } else if (type === 'room') {
      document.dispatchEvent(new CustomEvent('rrms:open-room', { detail: { id: id } }));
    } else if (type === 'tenant') {
      document.dispatchEvent(new CustomEvent('rrms:open-tenant', { detail: { id: id } }));
    } else if (type === 'location') {
      document.dispatchEvent(new CustomEvent('rrms:filter-location', { detail: { id: id } }));
    }
  }

  function switchLanguage(lang) {
    if (I18n.getLanguage() === lang) return;
    I18n.setLanguage(lang);
    updateLanguageUi();
    renderNotifications();
    updateUserUi();
    document.title = t('app.documentTitle');
    UI.toast(lang === 'km' ? t('lang.switchedKm') : t('lang.switchedEn'), 'success');
  }

  function updateLanguageUi() {
    var lang = I18n.getLanguage();
    var label = document.getElementById('langLabel');
    if (label) label.textContent = lang === 'km' ? 'ខ្មែរ' : 'English';
    document.querySelectorAll('#langMenu [data-set-lang]').forEach(function (button) {
      button.classList.toggle('is-active', button.getAttribute('data-set-lang') === lang);
    });
  }

  function updateUserUi() {
    if (!session) return;
    var name = Auth.displayName(session, t);
    var role = t('topbar.userRole');
    var avatar = session.user.demo ? 'A' : UI.initials(name || session.user.email);
    document.querySelectorAll('[data-user-name]').forEach(function (node) { node.textContent = name; });
    document.querySelectorAll('[data-user-role]').forEach(function (node) { node.textContent = role; });
    document.querySelectorAll('[data-user-avatar]').forEach(function (node) {
      node.textContent = avatar;
    });
  }

  function applyDemoVisibility() {
    var isDemo = !!RRMS.Config.demoMode;
    document.querySelectorAll('.demo-pill').forEach(function (node) {
      node.classList.toggle('hidden', !isDemo);
    });
    var banner = document.getElementById('demoBanner');
    if (banner) banner.classList.toggle('hidden', !isDemo);
  }

  async function signOut() {
    await Auth.signOut();
    window.location.replace('../login.html');
  }

  /* ----------------------------------------------------------- search */
  function initSearch() {
    var input = document.getElementById('globalSearch');
    var panel = document.getElementById('searchPanel');
    var topbar = document.getElementById('topbar');
    var toggle = document.getElementById('mobileSearchToggle');
    if (!input || !panel) return;

    function closePanel() {
      panel.hidden = true;
      panel.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
    }

    function resultMarkup(result) {
      var title = langPick(result.titleKm, result.titleEn);
      var subtitle = langPick(result.subtitleKm, result.subtitleEn);
      var meta = langPick(result.metaKm, result.metaEn);
      return '<button type="button" class="search-result" data-result-type="' + UI.esc(result.type) +
        '" data-result-id="' + UI.esc(result.id) + '">' +
        '<span class="search-result-icon">' + Icons.svg(
          result.type === 'tenant' ? 'user' :
            result.type === 'room' ? 'door' :
              result.type === 'invoice' ? 'receipt' : 'building', 18
        ) + '</span>' +
        '<span class="search-result-copy"><strong>' + UI.esc(title) + '</strong>' +
        '<small>' + UI.esc(subtitle) + '</small></span>' +
        (meta ? '<span class="search-result-meta">' + UI.esc(meta) + '</span>' : '') +
        '</button>';
    }

    function groupMarkup(labelKey, items) {
      if (!items.length) return '';
      return '<div class="search-group"><p class="search-group-label">' + UI.esc(t(labelKey)) + '</p>' +
        items.map(resultMarkup).join('') + '</div>';
    }

    function runSearch() {
      var query = input.value.trim();
      if (!query) { closePanel(); return; }
      var results = Store.search(query);
      var html = '';
      if (!results.total) {
        html = '<div class="search-empty">' + Icons.svg('search', 22) +
          '<span>' + UI.esc(t('search.noResults', { query: query })) + '</span></div>';
      } else {
        html += groupMarkup('search.tenants', results.tenants);
        html += groupMarkup('search.rooms', results.rooms);
        html += groupMarkup('search.invoices', results.invoices);
        html += groupMarkup('search.locations', results.locations);
      }
      panel.innerHTML = html;
      panel.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    var debounced = UI.debounce(runSearch, 170);
    input.addEventListener('input', debounced);
    input.addEventListener('focus', function () { if (input.value.trim()) runSearch(); });

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { closePanel(); input.blur(); return; }
      if (event.key === 'ArrowDown') {
        var first = panel.querySelector('.search-result');
        if (first) { event.preventDefault(); first.focus(); }
      }
      if (event.key === 'Enter') {
        var firstResult = panel.querySelector('.search-result');
        if (firstResult) { event.preventDefault(); firstResult.click(); }
      }
    });

    panel.addEventListener('click', function (event) {
      var button = event.target.closest('.search-result');
      if (!button) return;
      var type = button.getAttribute('data-result-type');
      var id = button.getAttribute('data-result-id');
      closePanel();
      input.value = '';
      if (topbar) topbar.classList.remove('search-open');
      openEntity(type, id);
    });

    document.addEventListener('click', function (event) {
      if (!panel.hidden && !panel.contains(event.target) && event.target !== input) closePanel();
      var langMenu = document.getElementById('langMenu');
      if (langMenu && !langMenu.hidden && !event.target.closest('#langSwitch')) {
        langMenu.hidden = true;
      }
      var notifPanel = document.getElementById('notifPanel');
      if (notifPanel && !notifPanel.hidden &&
        !event.target.closest('#notifPanel') && !event.target.closest('#notifButton')) {
        notifPanel.hidden = true;
      }
    });

    document.addEventListener('keydown', function (event) {
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      var typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (document.activeElement && document.activeElement.isContentEditable);
      if (event.key === '/' && !typing) {
        event.preventDefault();
        if (topbar) topbar.classList.add('search-open');
        input.focus();
      }
      if (event.key === 'Escape') {
        closePanel();
        var notifPanel = document.getElementById('notifPanel');
        if (notifPanel) notifPanel.hidden = true;
        var langMenu = document.getElementById('langMenu');
        if (langMenu) langMenu.hidden = true;
      }
    });

    if (toggle && topbar) {
      toggle.addEventListener('click', function () {
        topbar.classList.toggle('search-open');
        if (topbar.classList.contains('search-open')) {
          window.setTimeout(function () { input.focus(); }, 30);
        } else {
          closePanel();
        }
      });
    }
  }

  /* ------------------------------------------------------ notifications */
  function notificationText(notification) {
    return {
      title: t(notification.titleKey, notification.titleParams),
      body: notification.bodyKey ? t(notification.bodyKey, notification.bodyParams) : ''
    };
  }

  function unreadCount() {
    return Store.getNotifications().filter(function (notification) {
      return !readNotifications[notification.id];
    }).length;
  }

  function updateNotifDot() {
    var dot = document.getElementById('notifDot');
    if (!dot) return;
    dot.classList.toggle('is-visible', unreadCount() > 0);
  }

  function renderNotifications() {
    var panel = document.getElementById('notifPanel');
    if (!panel) return;
    var notifications = Store.getNotifications();
    var unread = unreadCount();
    var rows = notifications.length
      ? notifications.map(function (notification) {
        var text = notificationText(notification);
        return '<button type="button" class="notif-item' +
          (readNotifications[notification.id] ? ' is-read' : '') +
          '" data-notif-id="' + UI.esc(notification.id) + '"' +
          (notification.invoiceId ? ' data-notif-invoice="' + UI.esc(notification.invoiceId) + '"' : '') +
          (notification.roomId ? ' data-notif-room="' + UI.esc(notification.roomId) + '"' : '') + '>' +
          '<span class="notif-icon notif-' + UI.esc(notification.severity) + '">' +
            Icons.svg(notification.icon, 18) + '</span>' +
          '<span class="notif-copy"><strong>' + UI.esc(text.title) + '</strong>' +
            '<small>' + UI.esc(text.body) + '</small></span>' +
          '<span class="notif-unread"></span>' +
          '</button>';
      }).join('')
      : '<div class="notif-empty">' + Icons.svg('checkout', 22) +
        '<span>' + UI.esc(t('reminders.empty')) + '</span></div>';

    panel.innerHTML =
      '<div class="notif-head">' +
        '<div><h3>' + UI.esc(t('reminders.bellLabel')) + '</h3>' +
        '<p>' + UI.esc(unread ? t('reminders.newCount', { count: unread }) : t('reminders.empty')) + '</p></div>' +
        (unread ? '<button type="button" class="link-button" id="markAllRead">' +
          UI.esc(t('reminders.markAllRead')) + '</button>' : '') +
      '</div>' +
      '<div class="notif-list">' + rows + '</div>';

    updateNotifDot();

    panel.querySelectorAll('.notif-item').forEach(function (button) {
      button.addEventListener('click', function () {
        readNotifications[button.getAttribute('data-notif-id')] = true;
        button.classList.add('is-read');
        panel.hidden = true;
        updateNotifDot();
        var invoiceId = button.getAttribute('data-notif-invoice');
        var roomId = button.getAttribute('data-notif-room');
        if (invoiceId) openEntity('invoice', invoiceId);
        else if (roomId) openEntity('room', roomId);
      });
    });

    var markAll = panel.querySelector('#markAllRead');
    if (markAll) {
      markAll.addEventListener('click', function () {
        notifications.forEach(function (notification) { readNotifications[notification.id] = true; });
        renderNotifications();
        UI.toast(t('toast.markedRead'), 'success');
      });
    }
  }

  function initNotifications() {
    var button = document.getElementById('notifButton');
    var panel = document.getElementById('notifPanel');
    if (!button || !panel) return;
    renderNotifications();
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      var isOpening = panel.hidden;
      panel.hidden = !isOpening;
      if (isOpening) renderNotifications();
    });
  }

  /* ------------------------------------------------------------ sidebar */
  function initSidebar() {
    var body = document.body;
    var toggle = document.getElementById('sidebarToggle');
    var stored = false;
    try { stored = window.localStorage.getItem(RRMS.Config.keys.sidebar) === '1'; } catch (err) { /* ignore */ }
    body.classList.toggle('sidebar-collapsed', stored);

    if (toggle) {
      toggle.addEventListener('click', function () {
        var collapsed = body.classList.toggle('sidebar-collapsed');
        try { window.localStorage.setItem(RRMS.Config.keys.sidebar, collapsed ? '1' : '0'); } catch (err) { /* ignore */ }
        window.setTimeout(function () {
          document.dispatchEvent(new CustomEvent('rrms:sidebar-toggle'));
        }, 180);
      });
    }
  }

  function bindNavigation() {
    document.querySelectorAll('[data-nav]').forEach(function (button) {
      button.addEventListener('click', function (event) {
        event.preventDefault();
        var key = button.getAttribute('data-nav');
        if (key === 'dashboard') {
          if (RRMS.Manager) {
            RRMS.Manager.navigate('dashboard');
          } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
          return;
        }
        if (RRMS.Manager && MODULE_PHASES[key]) {
          RRMS.Manager.navigate(key);
          return;
        }
        openComingSoon(key);
      });
    });

    var fab = document.getElementById('fabButton');
    if (fab) fab.addEventListener('click', openQuickActions);

    var more = document.querySelector('[data-more-button]');
    if (more) more.addEventListener('click', openMoreSheet);

    var avatar = document.getElementById('avatarButton');
    if (avatar) avatar.addEventListener('click', openMoreSheet);

    ['demoAboutBtn', 'demoAboutLink'].forEach(function (id) {
      var button = document.getElementById(id);
      if (button) button.addEventListener('click', openDemoModal);
    });
  }

  function initLanguage() {
    updateLanguageUi();
    var button = document.getElementById('langButton');
    var menu = document.getElementById('langMenu');
    if (button && menu) {
      button.addEventListener('click', function (event) {
        event.stopPropagation();
        menu.hidden = !menu.hidden;
      });
      menu.querySelectorAll('[data-set-lang]').forEach(function (item) {
        item.addEventListener('click', function () {
          menu.hidden = true;
          switchLanguage(item.getAttribute('data-set-lang'));
        });
      });
    }
    document.querySelectorAll('[data-lang-inline]').forEach(function (item) {
      item.addEventListener('click', function () {
        switchLanguage(item.getAttribute('data-lang-inline'));
      });
    });
  }

  function initPrint() {
    var button = document.getElementById('printBtn');
    if (button) button.addEventListener('click', function () { window.print(); });
  }

  async function start() {
    I18n = RRMS.I18n;
    UI = RRMS.UI;
    Store = RRMS.Store;
    Auth = RRMS.Auth;
    Icons = RRMS.Icons;
    F = RRMS.Format;

    I18n.init();
    Icons.hydrate(document);
    document.title = t('app.documentTitle');

    session = await Auth.init();
    if (!session) {
      session = Auth.requireAuth('../login.html');
      return;
    }

    updateUserUi();
    updateLanguageUi();
    applyDemoVisibility();
    initSidebar();
    bindNavigation();
    initLanguage();
    initNotifications();
    initSearch();
    initPrint();

    document.querySelectorAll('[data-app-version]').forEach(function (node) {
      node.textContent = t('mgmt.phase', { phase: RRMS.Config.phase }) + ' · v' + RRMS.Config.version;
    });
    document.addEventListener('rrms:data-change', function () {
      renderNotifications();
    });
    if (RRMS.Manager) RRMS.Manager.init();

    document.body.classList.add('is-ready');
  }

  RRMS.App = { start: start, openMoreSheet: openMoreSheet, openDemoModal: openDemoModal };

  document.addEventListener('DOMContentLoaded', function () {
    if (document.body.getAttribute('data-page') === 'dashboard') {
      start();
    }
  });
})();
