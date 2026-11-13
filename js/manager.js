/* ==========================================================================
   RRMS — Management module (phases 2, 3, 5, 6, 7)
   --------------------------------------------------------------------------
   Hash-routed views for locations, rooms, tenants, tenancies, meter readings,
   invoices, payments, reports and settings. Every figure is derived from
   RRMS.Store; every label comes from RRMS.I18n. The dashboard shell stays
   mounted so search, notifications and the language switch keep working.
   ========================================================================== */
(function () {
  'use strict';

  window.RRMS = window.RRMS || {};

  var I18n, Store, F, UI, Icons;
  var moduleEl = null;
  var dashboardEl = null;
  var initialized = false;
  var pendingAfter = null;
  var charts = {};

  var ROUTES = {
    locations: { phase: 2, icon: 'building' },
    rooms: { phase: 2, icon: 'door' },
    tenants: { phase: 2, icon: 'users' },
    tenancies: { phase: 2, icon: 'key' },
    meters: { phase: 3, icon: 'gauge' },
    invoices: { phase: 5, icon: 'receipt' },
    payments: { phase: 5, icon: 'wallet' },
    reports: { phase: 6, icon: 'chart' },
    settings: { phase: 7, icon: 'settings' }
  };

  var ALIASES = { meterReadings: 'meters' };
  var ROOM_TYPES = ['standard', 'large', 'small', 'studio', 'shop'];
  var ROOM_STATUSES = ['vacant', 'reserved', 'maintenance', 'inactive'];
  var PAYMENT_METHODS = ['cash', 'aba', 'acleda', 'bank_transfer', 'other'];
  var INVOICE_FILTER_STATUSES = ['paid', 'partial', 'unpaid', 'overdue', 'cancelled'];

  var state = { route: 'dashboard', filters: null };

  /* -------------------------------------------------------------- helpers */
  function t(key, params) { return I18n.t(key, params); }
  function esc(value) { return UI.esc(value); }
  function icon(name, size) { return Icons.svg(name, size); }
  function langPick(km, en) { return I18n.getLanguage() === 'en' ? en : km; }
  function lang() { return I18n.getLanguage(); }
  function normalize(value) {
    return String(value === null || value === undefined ? '' : value)
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function money(value) { return F.money(Number(value) || 0); }
  function locationName(location) {
    return location ? langPick(location.nameKm, location.nameEn) : '—';
  }
  function tenantName(tenant) {
    return tenant ? langPick(tenant.nameKm, tenant.nameEn) : '—';
  }
  function locationAddress(location) {
    return location ? langPick(location.addressKm, location.addressEn) : '';
  }
  function navLabel(route) {
    if (route === 'tenancies') return t('tenancies.title');
    return t('nav.' + (route === 'meters' ? 'meterReadings' : route));
  }
  function defaults() {
    var current = Store.getMeta().currentPeriod;
    return {
      rooms: { locationId: 'all', status: 'all' },
      tenants: {},
      tenancies: { status: 'all' },
      meters: { period: current, locationId: 'all' },
      invoices: { period: current, status: 'all', locationId: 'all' },
      payments: { period: current, method: 'all' },
      reports: { period: current, locationId: 'all' }
    };
  }
  function filtersFor(route) {
    if (!state.filters) state.filters = defaults();
    return state.filters[route] || {};
  }

  function option(value, label, selected) {
    return '<option value="' + esc(value) + '"' +
      (String(value) === String(selected) ? ' selected' : '') + '>' + esc(label) + '</option>';
  }
  function optionsFromList(list, selected, labelFor) {
    return list.map(function (item) {
      return option(item.value, item.label, selected);
    }).join('');
  }
  function statusOption(value, selected) {
    return option(value, t('status.' + value), selected);
  }

  function statCard(opts) {
    return '<article class="stat-card tone-' + opts.tone + '">' +
      '<div class="stat-head">' +
        '<span class="stat-icon">' + icon(opts.icon, 20) + '</span>' +
        '<span class="stat-label">' + esc(opts.label) + '</span>' +
      '</div>' +
      '<p class="stat-value">' + opts.value + '</p>' +
      '<div class="stat-meta"><span class="stat-meta-text">' + esc(opts.meta || '') + '</span></div>' +
      '</article>';
  }

  function summaryGrid(cards) {
    return '<section class="section mgmt-summary">' +
      '<div class="summary-grid">' + cards.join('') + '</div>' +
      '</section>';
  }

  function emptyState(messageKey, iconName) {
    return '<div class="empty-state mgmt-empty">' +
      '<span class="empty-icon">' + icon(iconName || 'inbox', 26) + '</span>' +
      '<p>' + esc(t(messageKey)) + '</p>' +
      '</div>';
  }

  function actionButton(action, id, iconName, labelKey, extraClass) {
    return '<button type="button" class="icon-button mgmt-action' +
      (extraClass ? ' ' + extraClass : '') + '" data-mgmt="' + esc(action) + '"' +
      (id ? ' data-id="' + esc(id) + '"' : '') +
      ' title="' + esc(t(labelKey)) + '" aria-label="' + esc(t(labelKey)) + '">' +
      icon(iconName, 16) + '</button>';
  }

  function primaryButton(action, labelKey, iconName, extra) {
    return '<button type="button" class="button button-primary button-icon-text" data-mgmt="' +
      esc(action) + '"' + (extra || '') + '>' + icon(iconName || 'plus', 17) +
      '<span>' + esc(t(labelKey)) + '</span></button>';
  }

  function filterBar(inner) {
    return '<section class="filter-bar mgmt-filters" aria-label="' + esc(t('common.filters')) + '">' +
      inner + '</section>';
  }

  function selectField(name, label, optionsHtml, dataAttr) {
    return '<div class="filter-field">' +
      '<label for="f-' + esc(name) + '">' + esc(label) + '</label>' +
      '<div class="select-wrap">' +
        '<span class="select-icon">' + icon('filter', 15) + '</span>' +
        '<select id="f-' + esc(name) + '" ' + (dataAttr || '') + '>' + optionsHtml + '</select>' +
        '<span class="select-chevron">' + icon('chevronDown', 14) + '</span>' +
      '</div>' +
      '</div>';
  }

  function searchField(placeholderKey) {
    return '<div class="filter-field mgmt-search-field">' +
      '<label for="mgmtSearch">' + esc(t('common.search')) + '</label>' +
      '<div class="input-with-icon">' +
        '<span class="input-icon">' + icon('search', 16) + '</span>' +
        '<input type="search" id="mgmtSearch" data-live-search autocomplete="off" ' +
          'placeholder="' + esc(t(placeholderKey || 'mgmt.searchPlaceholder')) + '">' +
      '</div>' +
      '</div>';
  }

  function tableCard(headers, rows, emptyHtml) {
    if (!rows.length) {
      return '<div class="card mgmt-table-card">' + emptyHtml + '</div>';
    }
    return '<div class="card mgmt-table-card">' +
      '<div class="table-wrap">' +
        '<table class="data-table mgmt-table">' +
          '<thead><tr>' + headers.map(function (header) {
            return '<th' + (header.align ? ' class="align-' + header.align + '"' : '') + '>' +
              esc(header.label) + '</th>';
          }).join('') + '</tr></thead>' +
          '<tbody>' + rows.join('') + '</tbody>' +
        '</table>' +
      '</div>' +
      '</div>';
  }

  function cell(label, value, className, raw) {
    return '<td data-label="' + esc(label) + '"' +
      (className ? ' class="' + className + '"' : '') + '>' +
      (raw ? value : esc(value)) + '</td>';
  }

  function detailItem(label, value) {
    return '<div class="detail-item"><span>' + esc(label) + '</span><strong>' +
      esc(value === null || value === undefined || value === '' ? '—' : value) + '</strong></div>';
  }

  function formField(label, control, hint) {
    return '<label class="form-field mgmt-field">' +
      '<span class="field-label">' + esc(label) + '</span>' + control +
      (hint ? '<small class="form-hint">' + esc(hint) + '</small>' : '') +
      '</label>';
  }

  function textInput(name, value, placeholder) {
    return '<input type="text" name="' + esc(name) + '" autocomplete="off" value="' +
      esc(value === undefined || value === null ? '' : value) + '"' +
      (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + '>';
  }

  function numberInput(name, value, step, min) {
    return '<input type="number" name="' + esc(name) + '" inputmode="decimal" step="' +
      esc(step || '0.01') + '" min="' + esc(min === undefined ? 0 : min) + '" value="' +
      esc(value === undefined || value === null ? '' : value) + '">';
  }

  function dateInput(name, value) {
    return '<input type="date" name="' + esc(name) + '" value="' + esc(value || '') + '">';
  }

  function selectInput(name, optionsHtml) {
    return '<div class="select-wrap"><select name="' + esc(name) + '">' + optionsHtml +
      '</select><span class="select-chevron">' + icon('chevronDown', 14) + '</span></div>';
  }

  function textareaInput(name, value, rows) {
    return '<textarea name="' + esc(name) + '" rows="' + (rows || 3) + '">' +
      esc(value || '') + '</textarea>';
  }

  function todayIso() {
    var now = new Date();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    return now.getFullYear() + '-' + month + '-' + day;
  }

  function formValue(dialog, name) {
    var node = dialog.querySelector('[name="' + name + '"]');
    return node ? node.value : '';
  }

  function formNumber(dialog, name) {
    var value = Number(formValue(dialog, name));
    return isFinite(value) ? value : 0;
  }

  function modalForm(opts) {
    var handle = UI.modal({
      title: opts.title,
      kicker: opts.kicker,
      subtitle: opts.subtitle,
      size: opts.size || 'md',
      body: '<form class="mgmt-form" novalidate>' +
        (opts.intro ? '<p class="modal-lead">' + esc(opts.intro) + '</p>' : '') +
        '<div class="form-grid">' + opts.body + '</div>' +
        (opts.hint ? '<p class="form-note">' + esc(opts.hint) + '</p>' : '') +
        '</form>',
      footer: '<button type="button" class="button button-ghost" data-close-modal>' +
          esc(t('common.cancel')) + '</button>' +
        '<button type="button" class="button button-primary" data-form-submit>' +
          esc(t(opts.submitKey || 'common.save')) + '</button>',
      onOpen: function (dialog) {
        var form = dialog.querySelector('form');
        dialog.querySelector('[data-close-modal]').addEventListener('click', UI.closeModal);
        var submit = dialog.querySelector('[data-form-submit]');
        submit.addEventListener('click', function () { opts.onSubmit(dialog, submit); });
        form.addEventListener('keydown', function (event) {
          if (event.key !== 'Enter') return;
          var tag = (event.target.tagName || '').toLowerCase();
          if (tag === 'textarea') return;
          event.preventDefault();
          submit.click();
        });
        window.setTimeout(function () {
          var first = form.querySelector('input, select, textarea');
          if (first) first.focus();
        }, 60);
      }
    });
    return handle;
  }

  function errorText(result) {
    var code = result && result.code ? result.code : 'generic';
    var params = Object.assign({}, (result && result.params) || {});
    if (typeof params.balance === 'number') params.balance = money(params.balance);
    return t('error.' + code, params);
  }

  function handleResult(result, successKey) {
    if (!result || result.ok === false) {
      UI.toast(errorText(result), 'error');
      return false;
    }
    UI.toast(t(successKey || 'mgmt.saved'), 'success');
    return true;
  }

  function confirmAction(opts) {
    var handle = UI.modal({
      title: t(opts.titleKey || 'mgmt.confirmTitle'),
      kicker: opts.kicker,
      size: 'sm',
      body: '<p class="modal-lead">' + esc(t(opts.bodyKey || 'mgmt.confirmDelete', opts.bodyParams)) + '</p>',
      footer: '<button type="button" class="button button-ghost" data-close-modal>' +
          esc(t('common.cancel')) + '</button>' +
        '<button type="button" class="button ' + (opts.danger === false ? 'button-primary' : 'button-danger') +
          '" data-confirm-action>' + esc(t(opts.confirmKey || 'common.delete')) + '</button>',
      onOpen: function (dialog) {
        dialog.querySelector('[data-close-modal]').addEventListener('click', UI.closeModal);
        dialog.querySelector('[data-confirm-action]').addEventListener('click', function () {
          UI.closeModal();
          window.setTimeout(opts.onConfirm, 160);
        });
      }
    });
    return handle;
  }

  function download(filename, content, type) {
    try {
      var blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      window.setTimeout(function () {
        URL.revokeObjectURL(url);
        if (link.parentNode) link.parentNode.removeChild(link);
      }, 400);
      return true;
    } catch (err) {
      if (window.console) console.warn('[Manager] Download failed', err);
      return false;
    }
  }

  /* --------------------------------------------------------------- router */
  function parseHash() {
    var raw = String(window.location.hash || '').replace(/^#\/?/, '');
    var name = raw.split('?')[0];
    name = ALIASES[name] || name;
    return ROUTES[name] ? name : 'dashboard';
  }

  function navigate(route, after) {
    var target = ALIASES[route] || route;
    if (!ROUTES[target]) target = 'dashboard';
    var hash = '#/' + target;
    if (window.location.hash === hash) {
      applyRoute(target);
      if (typeof after === 'function') after();
      return;
    }
    pendingAfter = typeof after === 'function' ? after : null;
    window.location.hash = hash;
  }

  function applyRoute(route) {
    state.route = route;
    var isDashboard = route === 'dashboard';
    if (dashboardEl) dashboardEl.hidden = !isDashboard;
    if (moduleEl) moduleEl.hidden = isDashboard;
    updateNav(route);

    var crumb = document.getElementById('breadcrumbLabel');
    if (crumb) {
      if (isDashboard) {
        crumb.setAttribute('data-i18n', 'nav.dashboard');
        crumb.textContent = t('nav.dashboard');
      } else {
        crumb.removeAttribute('data-i18n');
        crumb.textContent = navLabel(route);
      }
    }
    document.title = isDashboard
      ? t('app.documentTitle')
      : navLabel(route) + ' | ' + t('app.title');

    if (isDashboard) {
      if (RRMS.Dashboard && typeof RRMS.Dashboard.refresh === 'function') RRMS.Dashboard.refresh();
      return;
    }
    renderModule(route);
  }

  function updateNav(route) {
    var key = route === 'meters' ? 'meterReadings' : route;
    document.querySelectorAll('[data-nav]').forEach(function (button) {
      button.classList.toggle('is-active', button.getAttribute('data-nav') === key);
    });
    document.querySelectorAll('[data-more-nav]').forEach(function (button) {
      button.classList.toggle('is-active', button.getAttribute('data-more-nav') === key);
    });
  }

  function renderModule(route) {
    if (!moduleEl) return;
    destroyCharts();
    var meta = ROUTES[route];
    var body;
    if (route === 'locations') body = viewLocations();
    else if (route === 'rooms') body = viewRooms();
    else if (route === 'tenants') body = viewTenants();
    else if (route === 'tenancies') body = viewTenancies();
    else if (route === 'meters') body = viewMeters();
    else if (route === 'invoices') body = viewInvoices();
    else if (route === 'payments') body = viewPayments();
    else if (route === 'reports') body = viewReports();
    else if (route === 'settings') body = viewSettings();
    else body = emptyState('common.noData', 'inbox');

    moduleEl.innerHTML =
      '<div class="page-heading mgmt-heading">' +
        '<div>' +
          '<p class="eyebrow">' + esc(t('mgmt.phase', { phase: meta.phase })) + ' • ' +
            esc(t('app.short')) + '</p>' +
          '<h1>' + esc(navLabel(route)) + '</h1>' +
          '<p class="page-subtitle">' + esc(t(route + '.subtitle')) + '</p>' +
        '</div>' +
        '<div class="page-actions">' + headingActions(route) + '</div>' +
      '</div>' +
      '<div class="mgmt-view" data-route="' + esc(route) + '">' + body + '</div>';

    Icons.hydrate(moduleEl);
    afterRender(route);
  }

  function headingActions(route) {
    if (route === 'locations') return primaryButton('loc-add', 'locations.add', 'plus');
    if (route === 'rooms') return primaryButton('room-add', 'rooms.add', 'plus');
    if (route === 'tenants') return primaryButton('tenant-add', 'tenants.add', 'userPlus');
    if (route === 'tenancies') return primaryButton('tenancy-add', 'tenancies.add', 'key');
    if (route === 'meters') {
      return '<button type="button" class="button button-primary button-icon-text" data-mgmt="reading-save-all">' +
        icon('check', 17) + '<span>' + esc(t('meters.save')) + '</span></button>';
    }
    if (route === 'invoices') {
      return '<button type="button" class="button button-secondary button-icon-text" data-mgmt="invoice-pay-new">' +
          icon('wallet', 17) + '<span>' + esc(t('payments.add')) + '</span></button>' +
        primaryButton('invoice-generate', 'invoices.generate', 'receipt');
    }
    if (route === 'payments') return primaryButton('payment-add', 'payments.add', 'wallet');
    if (route === 'reports') {
      return '<button type="button" class="button button-secondary button-icon-text" data-mgmt="report-print">' +
          icon('printer', 17) + '<span>' + esc(t('reports.print')) + '</span></button>' +
        '<button type="button" class="button button-secondary button-icon-text" data-mgmt="report-csv">' +
          icon('download', 17) + '<span>' + esc(t('reports.exportCsv')) + '</span></button>';
    }
    if (route === 'settings') {
      return '<button type="button" class="button button-primary button-icon-text" data-mgmt="settings-save">' +
        icon('check', 17) + '<span>' + esc(t('common.save')) + '</span></button>';
    }
    return '';
  }

  function afterRender(route) {
    if (route === 'reports') buildReportCharts();
    if (route === 'meters') {
      var first = moduleEl.querySelector('[data-reading]');
      if (first) first.focus();
    }
  }

  /* ------------------------------------------------------------ locations */
  function viewLocations() {
    var list = Store.getLocationList();
    var rooms = Store.getRooms();
    var locations = Store.getLocations();
    var active = locations.filter(function (item) { return item.status === 'active'; }).length;
    var occupied = list.reduce(function (total, item) { return total + item.occupied; }, 0);
    var outstanding = list.reduce(function (total, item) { return total + item.outstanding; }, 0);
    var billed = list.reduce(function (total, item) { return total + item.billed; }, 0);

    var cards = [
      statCard({ icon: 'building', tone: 'navy', label: t('nav.locations'), value: F.number(locations.length), meta: t('status.active') + ': ' + F.number(active) }),
      statCard({ icon: 'door', tone: 'blue', label: t('rooms.title'), value: F.number(rooms.length), meta: t('stats.roomsUnit') }),
      statCard({ icon: 'users', tone: 'green', label: t('properties.occupied'), value: F.number(occupied), meta: F.percent(rooms.length ? (occupied / rooms.length) * 100 : 0, 0) }),
      statCard({ icon: 'clock', tone: 'orange', label: t('locations.outstanding'), value: money(outstanding), meta: t('locations.billed') + ': ' + money(billed) })
    ];

    var grid = list.length
      ? '<div class="mgmt-grid">' + list.map(function (item) {
        var location = item.location;
        return '<article class="mgmt-card">' +
          '<div class="mgmt-card-top">' +
            '<span class="mgmt-card-icon tone-blue">' + icon('building', 21) + '</span>' +
            '<div class="mgmt-card-title">' +
              '<h3>' + esc(locationName(location)) + '</h3>' +
              '<p>' + icon('mapPin', 13) + '<span>' + esc(locationAddress(location) || '—') + '</span></p>' +
            '</div>' +
            UI.statusBadge(location.status, t) +
          '</div>' +
          '<div class="mgmt-metrics">' +
            '<div><strong>' + F.number(item.totalRooms) + '</strong><small>' + esc(t('common.rooms')) + '</small></div>' +
            '<div><strong class="text-success">' + F.number(item.occupied) + '</strong><small>' + esc(t('properties.occupied')) + '</small></div>' +
            '<div><strong>' + F.number(item.vacant) + '</strong><small>' + esc(t('properties.vacant')) + '</small></div>' +
            '<div><strong>' + F.percent(item.occupancyRate, 0) + '</strong><small>' + esc(t('locations.occupancy')) + '</small></div>' +
          '</div>' +
          '<div class="mgmt-money">' +
            '<div><small>' + esc(t('locations.billed')) + '</small><strong>' + money(item.billed) + '</strong></div>' +
            '<div><small>' + esc(t('locations.outstanding')) + '</small><strong class="' +
              (item.outstanding > 0.005 ? 'text-danger' : 'text-success') + '">' + money(item.outstanding) + '</strong></div>' +
          '</div>' +
          '<div class="mgmt-card-foot">' +
            '<button type="button" class="button button-ghost button-small" data-mgmt="loc-rooms" data-id="' +
              esc(location.id) + '">' + icon('door', 15) + '<span>' + esc(t('locations.manageRooms')) + '</span></button>' +
            '<span class="mgmt-spacer"></span>' +
            actionButton('loc-edit', location.id, 'settings', 'common.edit') +
            actionButton('loc-del', location.id, 'x', 'common.delete', 'is-danger') +
          '</div>' +
          '</article>';
      }).join('') + '</div>'
      : emptyState('locations.empty', 'building');

    return summaryGrid(cards) +
      '<section class="section">' +
        '<div class="section-heading"><div><h2>' + esc(t('nav.locations')) + '</h2>' +
          '<p>' + esc(t('mgmt.showingCount', { count: list.length })) + '</p></div></div>' +
        grid +
      '</section>';
  }

  function locationOptions(selected, includeAll) {
    var html = includeAll ? option('all', t('dashboard.allLocations'), selected) : '';
    return html + Store.getLocations().filter(function (location) {
      return location.status === 'active' || includeAll || location.id === selected;
    }).map(function (location) {
      return option(location.id, locationName(location), selected);
    }).join('');
  }

  function openLocationForm(locationId) {
    var location = locationId ? Store.getLocation(locationId) : null;
    var settings = Store.getSettings();
    modalForm({
      title: t(location ? 'locations.editTitle' : 'locations.formTitle'),
      kicker: t('mgmt.phase', { phase: 2 }),
      size: 'lg',
      submitKey: location ? 'common.update' : 'common.create',
      body:
        formField(t('locations.name'), textInput('nameKm', location ? location.nameKm : '')) +
        formField(t('locations.nameEn'), textInput('nameEn', location ? location.nameEn : '')) +
        formField(t('locations.addressKm'), textInput('addressKm', location ? location.addressKm : '')) +
        formField(t('locations.addressEn'), textInput('addressEn', location ? location.addressEn : '')) +
        formField(t('locations.contactName'), textInput('contactName', location ? location.contactName : '')) +
        formField(t('locations.contactPhone'), textInput('contactPhone', location ? location.contactPhone : '')) +
        formField(t('locations.electricityRate'), numberInput('electricityRate',
          location ? location.electricityRate : settings.defaultElectricityRate)) +
        formField(t('locations.waterRate'), numberInput('waterRate',
          location ? location.waterRate : settings.defaultWaterRate)) +
        formField(t('locations.defaultRent'), numberInput('defaultRent',
          location ? location.defaultRent : settings.defaultMonthlyRent)) +
        formField(t('common.status'), selectInput('status',
          statusOption('active', location ? location.status : 'active') +
          statusOption('inactive', location ? location.status : 'active')), t('locations.statusHint')) +
        '<div class="mgmt-field-wide">' + formField(t('locations.description'),
          textareaInput('descriptionKm', location ? location.descriptionKm : '')) + '</div>',
      hint: t('mgmt.formHint'),
      onSubmit: function (dialog) {
        var payload = {
          nameKm: formValue(dialog, 'nameKm'),
          nameEn: formValue(dialog, 'nameEn'),
          addressKm: formValue(dialog, 'addressKm'),
          addressEn: formValue(dialog, 'addressEn'),
          contactName: formValue(dialog, 'contactName'),
          contactPhone: formValue(dialog, 'contactPhone'),
          electricityRate: formNumber(dialog, 'electricityRate'),
          waterRate: formNumber(dialog, 'waterRate'),
          defaultRent: formNumber(dialog, 'defaultRent'),
          status: formValue(dialog, 'status'),
          descriptionKm: formValue(dialog, 'descriptionKm')
        };
        var result = location
          ? Store.updateLocation(location.id, payload)
          : Store.createLocation(payload);
        if (handleResult(result, location ? 'mgmt.updated' : 'mgmt.created')) UI.closeModal();
      }
    });
  }

  /* ---------------------------------------------------------------- rooms */
  function viewRooms() {
    var filters = filtersFor('rooms');
    var rows = Store.getRoomList(filters);
    var allRooms = Store.getRooms();
    var occupied = Store.getRoomList({ status: 'occupied' }).length;
    var outstanding = rows.reduce(function (total, row) { return total + row.balance; }, 0);

    var cards = [
      statCard({ icon: 'door', tone: 'navy', label: t('rooms.title'), value: F.number(allRooms.length), meta: t('stats.roomsUnit') }),
      statCard({ icon: 'users', tone: 'green', label: t('properties.occupied'), value: F.number(occupied), meta: F.percent(allRooms.length ? (occupied / allRooms.length) * 100 : 0, 0) }),
      statCard({ icon: 'home', tone: 'slate', label: t('properties.vacant'), value: F.number(rows.filter(function (row) { return row.status === 'vacant'; }).length), meta: t('rooms.filterStatus') }),
      statCard({ icon: 'clock', tone: 'orange', label: t('locations.outstanding'), value: money(outstanding), meta: t('mgmt.showingCount', { count: rows.length }) })
    ];

    var filtersHtml = filterBar(
      selectField('roomLocation', t('rooms.filterLocation'),
        locationOptions(filters.locationId, true), 'data-mgmt-filter="rooms.locationId"') +
      selectField('roomStatus', t('rooms.filterStatus'),
        option('all', t('common.all'), filters.status) +
        ['occupied'].concat(ROOM_STATUSES).map(function (status) {
          return statusOption(status, filters.status);
        }).join(''), 'data-mgmt-filter="rooms.status"') +
      searchField('mgmt.searchPlaceholder')
    );

    var body = rows.length
      ? tableCard([
        { label: t('rooms.number') },
        { label: t('rooms.filterLocation') },
        { label: t('rooms.type') },
        { label: t('rooms.tenant') },
        { label: t('rooms.rent'), align: 'right' },
        { label: t('common.status') },
        { label: t('common.actions'), align: 'right' }
      ], rows.map(function (row) {
        var room = row.room;
        var tenant = row.tenant;
        var searchText = normalize(room.number + ' ' + locationName(row.location) + ' ' +
          tenantName(tenant) + ' ' + t('roomType.' + room.type));
        return '<tr data-search-text="' + esc(searchText) + '">' +
          '<td data-label="' + esc(t('rooms.number')) + '"><button type="button" class="link-button mgmt-link" data-mgmt="room-view" data-id="' +
            esc(room.id) + '">' + esc(room.number) + '</button></td>' +
          cell(t('rooms.filterLocation'), locationName(row.location)) +
          cell(t('rooms.type'), t('roomType.' + room.type)) +
          cell(t('rooms.tenant'), tenant ? tenantName(tenant) : '—') +
          cell(t('rooms.rent'), money(room.monthlyRent), 'align-right') +
          '<td data-label="' + esc(t('common.status')) + '">' + UI.statusBadge(row.status, t) + '</td>' +
          '<td data-label="' + esc(t('common.actions')) + '" class="align-right"><div class="row-actions">' +
            actionButton('room-view', room.id, 'eye', 'common.view') +
            actionButton('room-edit', room.id, 'settings', 'common.edit') +
            actionButton('room-del', room.id, 'x', 'common.delete', 'is-danger') +
          '</div></td>' +
          '</tr>';
      }), emptyState('rooms.empty', 'door'))
      : '<div class="card mgmt-table-card">' + emptyState('rooms.empty', 'door') + '</div>';

    return summaryGrid(cards) + filtersHtml +
      '<section class="section">' + body + '</section>';
  }

  function roomOptions(selected, includeOccupied) {
    return Store.getRoomList({ status: 'all', period: Store.getMeta().currentPeriod })
      .filter(function (row) {
        return includeOccupied || row.status !== 'occupied' || row.room.id === selected;
      })
      .map(function (row) {
        var label = row.room.number + ' • ' + locationName(row.location);
        if (row.tenant) label += ' • ' + tenantName(row.tenant);
        return option(row.room.id, label, selected);
      }).join('');
  }

  function openRoomForm(roomId) {
    var room = roomId ? Store.getRoom(roomId) : null;
    var filters = filtersFor('rooms');
    var selectedLocation = room ? room.locationId : (filters.locationId !== 'all' ? filters.locationId : '');
    var locations = Store.getLocations().filter(function (location) {
      return location.status === 'active' || (room && room.locationId === location.id);
    });
    if (!locations.length) {
      UI.toast(t('error.locationRequired'), 'error');
      return;
    }
    if (!selectedLocation) selectedLocation = locations[0].id;

    modalForm({
      title: t(room ? 'rooms.editTitle' : 'rooms.formTitle'),
      kicker: t('mgmt.phase', { phase: 2 }),
      submitKey: room ? 'common.update' : 'common.create',
      body:
        formField(t('rooms.filterLocation'), selectInput('locationId', locations.map(function (location) {
          return option(location.id, locationName(location), selectedLocation);
        }).join(''))) +
        formField(t('rooms.number'), textInput('number', room ? room.number : '')) +
        formField(t('rooms.floor'), numberInput('floor', room ? room.floor : 1, '1', 0)) +
        formField(t('rooms.type'), selectInput('type', ROOM_TYPES.map(function (type) {
          return option(type, t('roomType.' + type), room ? room.type : 'standard');
        }).join(''))) +
        formField(t('rooms.rent'), numberInput('monthlyRent', room ? room.monthlyRent : '')) +
        formField(t('common.status'), selectInput('status', ROOM_STATUSES.map(function (status) {
          return statusOption(status, room ? room.status : 'vacant');
        }).join(''))) +
        '<div class="mgmt-field-wide">' + formField(t('rooms.notes'),
          textareaInput('notes', room ? room.notes : '')) + '</div>',
      hint: t('mgmt.formHint'),
      onSubmit: function (dialog) {
        var payload = {
          locationId: formValue(dialog, 'locationId'),
          number: formValue(dialog, 'number'),
          floor: formNumber(dialog, 'floor'),
          type: formValue(dialog, 'type'),
          monthlyRent: formNumber(dialog, 'monthlyRent'),
          status: formValue(dialog, 'status'),
          notes: formValue(dialog, 'notes')
        };
        var result = room ? Store.updateRoom(room.id, payload) : Store.createRoom(payload);
        if (handleResult(result, room ? 'mgmt.updated' : 'mgmt.created')) UI.closeModal();
      }
    });
  }

  function openRoomDetail(roomId) {
    var details = Store.getRoomDetails(roomId);
    if (!details) { UI.toast(t('mgmt.notFound'), 'error'); return; }
    var room = details.room;
    var tenant = details.tenant;
    var meterRows = details.meters.map(function (meter) {
      var reading = details.latestReadings[meter.utility];
      return '<div class="meter-row">' +
        '<span class="meter-icon tone-' + (meter.utility === 'electricity' ? 'blue' : 'green') + '">' +
          icon(meter.utility === 'electricity' ? 'bolt' : 'drop', 16) + '</span>' +
        '<span class="meter-copy"><strong>' + esc(t('meters.' + meter.utility)) + '</strong>' +
          '<small>' + esc(meter.meterNumber) + '</small></span>' +
        '<span class="meter-reading">' + (reading
          ? esc(F.number(reading.current, 2)) + ' • ' + esc(F.monthShort(reading.period))
          : esc(t('common.none'))) + '</span>' +
        '</div>';
    }).join('');

    var invoiceHtml = details.currentInvoice
      ? '<div class="mini-invoice-list"><button type="button" class="mini-invoice" data-mgmt="invoice-view" data-id="' +
          esc(details.currentInvoice.id) + '">' +
          '<span><strong>' + esc(details.currentInvoice.invoiceNumber) + '</strong>' +
            '<small>' + esc(F.monthLabel(details.currentInvoice.billingPeriod)) + '</small></span>' +
          '<span><strong>' + money(details.currentInvoice.total) + '</strong>' +
            UI.statusBadge(details.currentInvoice.displayStatus, t) + '</span>' +
          '</button></div>'
      : '<p class="empty-inline">' + esc(t('rooms.noInvoice')) + '</p>';

    var body =
      '<div class="room-hero">' +
        '<span class="room-hero-icon">' + icon('door', 24) + '</span>' +
        '<div class="room-hero-copy"><h3>' + esc(room.number) + '</h3>' +
          '<p>' + esc(locationName(details.location)) + ' • ' + esc(t('roomType.' + room.type)) + '</p></div>' +
        UI.statusBadge(details.tenancy ? 'occupied' : room.status, t) +
      '</div>' +
      '<div class="detail-meta-grid">' +
        detailItem(t('details.floor'), F.number(room.floor)) +
        detailItem(t('details.monthlyRent'), money(room.monthlyRent)) +
        detailItem(t('details.roomType'), t('roomType.' + room.type)) +
        detailItem(t('details.currentTenant'), tenant ? tenantName(tenant) : t('details.noTenant')) +
        detailItem(t('details.phone'), tenant ? F.phone(tenant.phone) : '—') +
        detailItem(t('rooms.history'), F.number(details.historyCount)) +
      '</div>' +
      (room.notes ? '<div class="detail-section"><h3>' + esc(t('rooms.notes')) + '</h3><p class="detail-note">' +
        esc(room.notes) + '</p></div>' : '') +
      '<div class="detail-section"><h3>' + esc(t('rooms.meters')) + '</h3>' +
        (meterRows || '<p class="empty-inline">' + esc(t('details.noMeter')) + '</p>') + '</div>' +
      '<div class="detail-section"><h3>' + esc(t('rooms.currentInvoice')) + '</h3>' + invoiceHtml + '</div>';

    UI.modal({
      title: room.number,
      kicker: t('rooms.detailTitle'),
      subtitle: locationName(details.location),
      body: body,
      footer:
        (details.tenancy
          ? '<button type="button" class="button button-ghost" data-mgmt="tenancy-end" data-id="' +
            esc(details.tenancy.id) + '">' + esc(t('tenants.moveOut')) + '</button>'
          : '<button type="button" class="button button-ghost" data-mgmt="room-assign" data-id="' +
            esc(room.id) + '">' + esc(t('rooms.assign')) + '</button>') +
        '<button type="button" class="button button-secondary" data-mgmt="room-edit" data-id="' +
          esc(room.id) + '">' + esc(t('common.edit')) + '</button>' +
        '<button type="button" class="button button-primary" data-close-modal>' +
          esc(t('common.close')) + '</button>',
      onOpen: function (dialog) {
        dialog.querySelector('[data-close-modal]').addEventListener('click', UI.closeModal);
      }
    });
  }

  /* -------------------------------------------------------------- tenants */
  function viewTenants() {
    var rows = Store.getTenantList({});
    var tenants = Store.getTenants();
    var housed = rows.filter(function (row) { return !!row.tenancy; }).length;
    var outstanding = rows.reduce(function (total, row) { return total + row.outstanding; }, 0);
    var invoices = rows.reduce(function (total, row) { return total + row.invoiceCount; }, 0);

    var cards = [
      statCard({ icon: 'users', tone: 'navy', label: t('nav.tenants'), value: F.number(tenants.length), meta: t('status.active') }),
      statCard({ icon: 'home', tone: 'green', label: t('details.currentTenant'), value: F.number(housed), meta: t('tenants.room') }),
      statCard({ icon: 'clock', tone: 'orange', label: t('tenants.outstanding'), value: money(outstanding), meta: t('invoices.title') }),
      statCard({ icon: 'receipt', tone: 'blue', label: t('tenants.invoices'), value: F.number(invoices), meta: t('mgmt.showingCount', { count: rows.length }) })
    ];

    var filtersHtml = filterBar(searchField('tenants.empty'));

    var body = rows.length
      ? tableCard([
        { label: t('tenants.name') },
        { label: t('tenants.phone') },
        { label: t('tenants.room') },
        { label: t('rooms.filterLocation') },
        { label: t('tenants.outstanding'), align: 'right' },
        { label: t('tenants.invoices'), align: 'right' },
        { label: t('common.actions'), align: 'right' }
      ], rows.map(function (row) {
        var tenant = row.tenant;
        var searchText = normalize(tenant.nameKm + ' ' + tenant.nameEn + ' ' + tenant.phone + ' ' +
          tenant.email + ' ' + (row.room ? row.room.number : '') + ' ' + locationName(row.location));
        return '<tr data-search-text="' + esc(searchText) + '">' +
          '<td data-label="' + esc(t('tenants.name')) + '"><button type="button" class="link-button mgmt-link" data-mgmt="tenant-view" data-id="' +
            esc(tenant.id) + '">' + esc(tenantName(tenant)) + '</button></td>' +
          cell(t('tenants.phone'), F.phone(tenant.phone)) +
          cell(t('tenants.room'), row.room ? row.room.number : t('tenants.noRoom')) +
          cell(t('rooms.filterLocation'), locationName(row.location)) +
          cell(t('tenants.outstanding'), money(row.outstanding), 'align-right' + (row.outstanding > 0.005 ? ' text-danger' : '')) +
          cell(t('tenants.invoices'), F.number(row.invoiceCount), 'align-right') +
          '<td data-label="' + esc(t('common.actions')) + '" class="align-right"><div class="row-actions">' +
            actionButton('tenant-view', tenant.id, 'eye', 'common.view') +
            actionButton('tenant-edit', tenant.id, 'settings', 'common.edit') +
            actionButton('tenant-del', tenant.id, 'x', 'common.delete', 'is-danger') +
          '</div></td>' +
          '</tr>';
      }), emptyState('tenants.empty', 'users'))
      : '<div class="card mgmt-table-card">' + emptyState('tenants.empty', 'users') + '</div>';

    return summaryGrid(cards) + filtersHtml + '<section class="section">' + body + '</section>';
  }

  function tenantSelectOptions(selected) {
    return Store.getTenantList({}).map(function (row) {
      var label = tenantName(row.tenant) + ' • ' + F.phone(row.tenant.phone) +
        (row.room ? ' • ' + row.room.number : '');
      return option(row.tenant.id, label, selected);
    }).join('');
  }

  function openTenantForm(tenantId) {
    var tenant = tenantId ? Store.getTenant(tenantId) : null;
    modalForm({
      title: t(tenant ? 'tenants.editTitle' : 'tenants.formTitle'),
      kicker: t('mgmt.phase', { phase: 2 }),
      size: 'lg',
      submitKey: tenant ? 'common.update' : 'common.create',
      body:
        formField(t('tenants.name'), textInput('nameKm', tenant ? tenant.nameKm : '')) +
        formField(t('tenants.nameEn'), textInput('nameEn', tenant ? tenant.nameEn : '')) +
        formField(t('tenants.phone'), textInput('phone', tenant ? tenant.phone : '', '012 345 678')) +
        formField(t('tenants.email'), textInput('email', tenant ? tenant.email : '')) +
        formField(t('tenants.idNumber'), textInput('idNumber', tenant ? tenant.idNumber : '')) +
        formField(t('tenants.address'), textInput('addressKm', tenant ? tenant.addressKm : '')) +
        formField(t('tenants.emergencyName'), textInput('emergencyContactName',
          tenant ? tenant.emergencyContactName : '')) +
        formField(t('tenants.emergencyPhone'), textInput('emergencyContactPhone',
          tenant ? tenant.emergencyContactPhone : '')) +
        (tenant ? formField(t('tenants.status'), selectInput('status',
          statusOption('active', tenant.status) + statusOption('inactive', tenant.status))) : '') +
        '<div class="mgmt-field-wide">' + formField(t('tenants.notes'),
          textareaInput('notes', tenant ? tenant.notes : '')) + '</div>',
      hint: t('mgmt.formHint'),
      onSubmit: function (dialog) {
        var payload = {
          nameKm: formValue(dialog, 'nameKm'),
          nameEn: formValue(dialog, 'nameEn'),
          phone: formValue(dialog, 'phone'),
          email: formValue(dialog, 'email'),
          idNumber: formValue(dialog, 'idNumber'),
          addressKm: formValue(dialog, 'addressKm'),
          emergencyContactName: formValue(dialog, 'emergencyContactName'),
          emergencyContactPhone: formValue(dialog, 'emergencyContactPhone'),
          notes: formValue(dialog, 'notes')
        };
        if (tenant) payload.status = formValue(dialog, 'status');
        var result = tenant ? Store.updateTenant(tenant.id, payload) : Store.createTenant(payload);
        if (handleResult(result, tenant ? 'mgmt.updated' : 'mgmt.created')) UI.closeModal();
      }
    });
  }

  function openTenantDetail(tenantId) {
    var details = Store.getTenantDetails(tenantId);
    if (!details) { UI.toast(t('mgmt.notFound'), 'error'); return; }
    var tenant = details.tenant;
    var openInvoices = details.openInvoices.length
      ? '<div class="mini-invoice-list">' + details.openInvoices.map(function (invoice) {
        return '<button type="button" class="mini-invoice" data-mgmt="invoice-view" data-id="' + esc(invoice.id) + '">' +
          '<span><strong>' + esc(invoice.invoiceNumber) + '</strong>' +
            '<small>' + esc(F.monthLabel(invoice.billingPeriod)) + '</small></span>' +
          '<span><strong>' + money(invoice.balance) + '</strong>' +
            UI.statusBadge(invoice.displayStatus, t) + '</span>' +
          '</button>';
      }).join('') + '</div>'
      : '<p class="empty-inline">' + esc(t('details.noOpenInvoices')) + '</p>';

    var body =
      '<div class="tenant-hero">' +
        '<span class="avatar tenant-avatar">' + esc(UI.initials(langPick(tenant.nameKm, tenant.nameEn))) + '</span>' +
        '<div class="tenant-hero-copy"><h3>' + esc(tenantName(tenant)) + '</h3>' +
          '<p>' + esc(F.phone(tenant.phone)) + '</p></div>' +
        '<div class="tenant-hero-balance"><small>' + esc(t('tenants.outstanding')) + '</small>' +
          '<strong class="' + (details.totalOutstanding > 0.005 ? 'text-danger' : 'text-success') + '">' +
            money(details.totalOutstanding) + '</strong></div>' +
      '</div>' +
      '<div class="detail-meta-grid">' +
        detailItem(t('tenants.email'), tenant.email || '—') +
        detailItem(t('tenants.idNumber'), tenant.idNumber || '—') +
        detailItem(t('tenants.address'), tenant.addressKm || '—') +
        detailItem(t('tenants.room'), details.room ? details.room.number : t('tenants.noRoom')) +
        detailItem(t('rooms.filterLocation'), details.location ? locationName(details.location) : '—') +
        detailItem(t('tenants.invoices'), F.number(details.invoiceCount)) +
        detailItem(t('tenants.emergencyName'), tenant.emergencyContactName || '—') +
        detailItem(t('tenants.emergencyPhone'), tenant.emergencyContactPhone || '—') +
      '</div>' +
      (details.tenancy
        ? '<div class="detail-section"><h3>' + esc(t('tenancies.title')) + '</h3>' +
          '<div class="detail-meta-grid">' +
            detailItem(t('tenancies.start'), F.date(details.tenancy.startDate)) +
            detailItem(t('tenancies.end'), details.tenancy.endDate ? F.date(details.tenancy.endDate) : t('tenancies.openEnded')) +
            detailItem(t('tenancies.rent'), money(details.tenancy.monthlyRent)) +
            detailItem(t('tenancies.deposit'), money(details.tenancy.depositAmount)) +
          '</div></div>'
        : '') +
      '<div class="detail-section"><h3>' + esc(t('details.openInvoices')) + '</h3>' + openInvoices + '</div>';

    UI.modal({
      title: tenantName(tenant),
      kicker: t('tenants.detailTitle'),
      subtitle: details.room ? t('tenants.room') + ' ' + details.room.number : t('tenants.noRoom'),
      body: body,
      footer:
        (details.tenancy
          ? '<button type="button" class="button button-ghost" data-mgmt="tenancy-end" data-id="' +
            esc(details.tenancy.id) + '">' + esc(t('tenants.moveOut')) + '</button>'
          : '<button type="button" class="button button-ghost" data-mgmt="tenant-assign" data-id="' +
            esc(tenant.id) + '">' + esc(t('tenants.assignRoom')) + '</button>') +
        '<button type="button" class="button button-secondary" data-mgmt="invoices-filter-tenant" data-id="' +
          esc(tenant.id) + '">' + esc(t('tenants.viewInvoices')) + '</button>' +
        '<button type="button" class="button button-primary" data-close-modal>' +
          esc(t('common.close')) + '</button>',
      onOpen: function (dialog) {
        dialog.querySelector('[data-close-modal]').addEventListener('click', UI.closeModal);
      }
    });
  }

  /* ------------------------------------------------------------ tenancies */
  function viewTenancies() {
    var filters = filtersFor('tenancies');
    var rows = Store.getTenancyList({ status: filters.status });
    var active = Store.getTenancies().filter(function (item) { return item.status === 'active'; }).length;
    var deposits = rows.reduce(function (total, row) {
      return total + (row.tenancy.status === 'active' ? Number(row.tenancy.depositPaid) || 0 : 0);
    }, 0);
    var monthly = rows.reduce(function (total, row) {
      return total + (row.tenancy.status === 'active' ? Number(row.tenancy.monthlyRent) || 0 : 0);
    }, 0);

    var cards = [
      statCard({ icon: 'key', tone: 'navy', label: t('tenancies.active'), value: F.number(active), meta: t('tenancies.title') }),
      statCard({ icon: 'calendar', tone: 'blue', label: t('tenancies.start'), value: F.number(rows.length), meta: t('mgmt.showingCount', { count: rows.length }) }),
      statCard({ icon: 'wallet', tone: 'green', label: t('tenancies.depositPaid'), value: money(deposits), meta: t('tenancies.deposit') }),
      statCard({ icon: 'chart', tone: 'orange', label: t('tenancies.rent'), value: money(monthly), meta: t('common.perMonth') })
    ];

    var filtersHtml = filterBar(
      selectField('tenancyStatus', t('tenancies.status'),
        option('all', t('common.all'), filters.status) +
        ['active', 'ended', 'cancelled'].map(function (status) {
          return statusOption(status, filters.status);
        }).join(''), 'data-mgmt-filter="tenancies.status"')
    );

    var body = rows.length
      ? tableCard([
        { label: t('tenancies.tenant') },
        { label: t('tenancies.room') },
        { label: t('rooms.filterLocation') },
        { label: t('tenancies.start') },
        { label: t('tenancies.end') },
        { label: t('tenancies.rent'), align: 'right' },
        { label: t('tenancies.deposit'), align: 'right' },
        { label: t('common.status') },
        { label: t('common.actions'), align: 'right' }
      ], rows.map(function (row) {
        var tenancy = row.tenancy;
        return '<tr data-search-text="' + esc(normalize(tenantName(row.tenant) + ' ' +
          (row.room ? row.room.number : '') + ' ' + locationName(row.location))) + '">' +
          '<td data-label="' + esc(t('tenancies.tenant')) + '"><button type="button" class="link-button mgmt-link" data-mgmt="tenant-view" data-id="' +
            esc(tenancy.tenantId) + '">' + esc(tenantName(row.tenant)) + '</button></td>' +
          cell(t('tenancies.room'), row.room ? row.room.number : '—') +
          cell(t('rooms.filterLocation'), locationName(row.location)) +
          cell(t('tenancies.start'), F.date(tenancy.startDate)) +
          cell(t('tenancies.end'), tenancy.endDate ? F.date(tenancy.endDate) : t('tenancies.openEnded')) +
          cell(t('tenancies.rent'), money(tenancy.monthlyRent), 'align-right') +
          cell(t('tenancies.deposit'), money(tenancy.depositAmount), 'align-right') +
          '<td data-label="' + esc(t('common.status')) + '">' + UI.statusBadge(tenancy.status, t) + '</td>' +
          '<td data-label="' + esc(t('common.actions')) + '" class="align-right"><div class="row-actions">' +
            (tenancy.status === 'active'
              ? actionButton('tenancy-end', tenancy.id, 'logout', 'tenants.moveOut')
              : '') +
            actionButton('tenancy-del', tenancy.id, 'x', 'common.delete', 'is-danger') +
          '</div></td>' +
          '</tr>';
      }), emptyState('tenancies.empty', 'key'))
      : '<div class="card mgmt-table-card">' + emptyState('tenancies.empty', 'key') + '</div>';

    return summaryGrid(cards) + filtersHtml + '<section class="section">' + body + '</section>';
  }

  function openTenancyForm(opts) {
    var options = opts || {};
    if (!Store.getTenants().length || !Store.getRooms().length) {
      UI.toast(t('tenancies.empty'), 'error');
      return;
    }
    var presetTenant = options.tenantId || '';
    var presetRoom = options.roomId || '';
    var start = todayIso();

    var handle = modalForm({
      title: t('tenancies.formTitle'),
      kicker: t('mgmt.phase', { phase: 2 }),
      size: 'lg',
      submitKey: 'common.create',
      intro: t('tenancies.subtitle'),
      body:
        formField(t('tenancies.tenant'), selectInput('tenantId',
          (presetTenant ? '' : option('', t('tenancies.tenant') + '…', '')) + tenantSelectOptions(presetTenant))) +
        formField(t('tenancies.room'), selectInput('roomId',
          (presetRoom ? '' : option('', t('tenancies.room') + '…', '')) + roomOptions(presetRoom, false))) +
        formField(t('tenancies.start'), dateInput('startDate', start)) +
        formField(t('tenancies.end'), dateInput('endDate', '')) +
        formField(t('tenancies.rent'), numberInput('monthlyRent', '')) +
        formField(t('tenancies.deposit'), numberInput('depositAmount', '')) +
        '<div class="mgmt-field-wide">' + formField(t('common.notes'), textareaInput('notes', '')) + '</div>',
      hint: t('mgmt.formHint'),
      onSubmit: function (dialog) {
        var roomId = formValue(dialog, 'roomId');
        var room = Store.getRoom(roomId);
        var payload = {
          tenantId: formValue(dialog, 'tenantId'),
          roomId: roomId,
          startDate: formValue(dialog, 'startDate'),
          endDate: formValue(dialog, 'endDate') || null,
          monthlyRent: formNumber(dialog, 'monthlyRent') || (room ? room.monthlyRent : 0),
          depositAmount: formNumber(dialog, 'depositAmount') || (room ? room.monthlyRent : 0),
          notes: formValue(dialog, 'notes')
        };
        if (handleResult(Store.assignTenant(payload), 'mgmt.created')) UI.closeModal();
      }
    });

    var dialog = handle.dialog;
    if (!dialog) return;
    var roomSelect = dialog.querySelector('[name="roomId"]');
    var rentInput = dialog.querySelector('[name="monthlyRent"]');
    var depositInput = dialog.querySelector('[name="depositAmount"]');
    if (roomSelect) {
      roomSelect.addEventListener('change', function () {
        var room = Store.getRoom(roomSelect.value);
        if (!room) return;
        if (rentInput) rentInput.value = room.monthlyRent;
        if (depositInput) depositInput.value = room.monthlyRent;
      });
      if (presetRoom) {
        var presetRoomRecord = Store.getRoom(presetRoom);
        if (presetRoomRecord) {
          if (rentInput) rentInput.value = presetRoomRecord.monthlyRent;
          if (depositInput) depositInput.value = presetRoomRecord.monthlyRent;
        }
      }
    }
  }

  function openEndTenancy(tenancyId) {
    var tenancy = Store.getTenancies().find(function (item) { return item.id === tenancyId; });
    if (!tenancy) { UI.toast(t('mgmt.notFound'), 'error'); return; }
    var tenant = Store.getTenant(tenancy.tenantId);
    var room = Store.getRoom(tenancy.roomId);
    modalForm({
      title: t('tenancies.endTitle'),
      kicker: tenantName(tenant) + (room ? ' • ' + room.number : ''),
      size: 'sm',
      submitKey: 'common.confirm',
      intro: t('mgmt.confirmEndBody'),
      body:
        formField(t('tenancies.endDate'), dateInput('endDate', todayIso())) +
        formField(t('tenancies.moveOutDate'), dateInput('moveOutDate', todayIso())) +
        '<div class="mgmt-field-wide">' + formField(t('common.notes'), textareaInput('notes', tenancy.notes || '')) + '</div>',
      onSubmit: function (dialog) {
        var payload = {
          endDate: formValue(dialog, 'endDate'),
          moveOutDate: formValue(dialog, 'moveOutDate') || formValue(dialog, 'endDate'),
          notes: formValue(dialog, 'notes')
        };
        if (handleResult(Store.endTenancy(tenancy.id, payload), 'mgmt.updated')) UI.closeModal();
      }
    });
  }

  /* --------------------------------------------------------------- meters */
  function viewMeters() {
    var filters = filtersFor('meters');
    var list = Store.getMeterList(filters.period, filters.locationId);
    var rows = list.rows;
    var located = Store.getLocations();
    var saved = rows.filter(function (row) {
      return row.electricity || row.water;
    }).length;

    var cards = [
      statCard({ icon: 'gauge', tone: 'navy', label: t('meters.period'), value: F.monthLabel(list.period), meta: t('meters.subtitle') }),
      statCard({ icon: 'door', tone: 'blue', label: t('properties.occupied'), value: F.number(list.occupiedCount), meta: t('mgmt.showingCount', { count: rows.length }) }),
      statCard({ icon: 'checkout', tone: 'green', label: t('meters.savedShort'), value: F.number(saved), meta: t('meters.room') }),
      statCard({ icon: 'warning', tone: list.missingCount ? 'orange' : 'slate', label: t('meters.missing'), value: F.number(list.missingCount), meta: list.missingCount ? t('meters.missingCount', { count: list.missingCount }) : t('meters.complete') })
    ];

    var filtersHtml = filterBar(
      selectField('meterPeriod', t('meters.period'), Store.monthOptions().map(function (period) {
        return option(period, F.monthLabel(period), filters.period);
      }).join(''), 'data-mgmt-filter="meters.period"') +
      selectField('meterLocation', t('meters.room') + ' • ' + t('rooms.filterLocation'),
        locationOptions(filters.locationId, true), 'data-mgmt-filter="meters.locationId"') +
      '<p class="filter-hint">' + esc(t('meters.hint')) + '</p>'
    );

    var body = rows.length
      ? '<div class="card mgmt-table-card"><div class="table-wrap">' +
        '<table class="data-table mgmt-table meter-table"><thead><tr>' +
          '<th>' + esc(t('meters.room')) + '</th>' +
          '<th>' + esc(t('meters.tenant')) + '</th>' +
          '<th>' + esc(t('meters.electricity')) + '</th>' +
          '<th>' + esc(t('meters.water')) + '</th>' +
          '<th class="align-right">' + esc(t('common.actions')) + '</th>' +
        '</tr></thead><tbody>' +
        rows.map(function (row) {
          var location = row.location;
          var eRate = location ? location.electricityRate : 0;
          var wRate = location ? location.waterRate : 0;
          var disabled = !row.tenancy;
          function cellFor(utility, reading, previous, rate) {
            return '<td data-label="' + esc(t('meters.' + utility)) + '" class="meter-cell">' +
              '<div class="meter-entry">' +
                '<div class="meter-prev"><span>' + esc(t('meters.previous')) + '</span><strong>' +
                  esc(F.number(previous, 2)) + '</strong></div>' +
                '<input type="number" step="0.01" min="0" data-reading="' + utility + '"' +
                  ' data-prev="' + esc(previous) + '" data-rate="' + esc(rate) + '"' +
                  (reading ? ' value="' + esc(reading.current) + '"' : '') +
                  (disabled ? ' disabled' : '') +
                  ' aria-label="' + esc(t('meters.' + utility) + ' ' + t('meters.current')) + '">' +
                '<div class="meter-calc">' +
                  '<span data-usage="' + utility + '">' +
                    (reading ? esc(F.number(reading.consumption, 2)) : '—') + '</span>' +
                  '<strong data-amount="' + utility + '">' +
                    (reading ? money(reading.amount) : '—') + '</strong>' +
                '</div>' +
              '</div>' +
              '</td>';
          }
          return '<tr data-meter-row data-room-id="' + esc(row.room.id) + '">' +
            '<td data-label="' + esc(t('meters.room')) + '"><strong>' + esc(row.room.number) + '</strong>' +
              '<small class="cell-sub">' + esc(locationName(location)) + '</small></td>' +
            '<td data-label="' + esc(t('meters.tenant')) + '">' + (row.tenant
              ? esc(tenantName(row.tenant))
              : '<span class="muted">' + esc(t('meters.noTenancy')) + '</span>') + '</td>' +
            cellFor('electricity', row.electricity, row.electricityPrevious, eRate) +
            cellFor('water', row.water, row.waterPrevious, wRate) +
            '<td data-label="' + esc(t('common.actions')) + '" class="align-right">' +
              '<button type="button" class="button button-secondary button-small" data-mgmt="reading-save" data-id="' +
                esc(row.room.id) + '"' + (disabled ? ' disabled' : '') + '>' +
                icon('check', 15) + '<span>' + esc(t('common.save')) + '</span></button>' +
            '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table></div></div>'
      : '<div class="card mgmt-table-card">' + emptyState('meters.empty', 'gauge') + '</div>';

    return summaryGrid(cards) + filtersHtml + '<section class="section">' + body + '</section>';
  }

  function collectReadingValues(rowEl) {
    var values = {};
    rowEl.querySelectorAll('[data-reading]').forEach(function (input) {
      if (String(input.value).trim() === '') return;
      values[input.getAttribute('data-reading')] = Number(input.value);
    });
    return values;
  }

  function saveMeterRow(rowEl) {
    var roomId = rowEl.getAttribute('data-room-id');
    var period = filtersFor('meters').period;
    var values = collectReadingValues(rowEl);
    var utilities = Object.keys(values);
    if (!utilities.length) return { ok: false, code: 'needValue' };
    var firstError = null;
    utilities.forEach(function (utility) {
      var result = Store.saveReading({
        roomId: roomId,
        utility: utility,
        period: period,
        current: values[utility]
      });
      if (!result.ok && !firstError) firstError = result;
    });
    return firstError || { ok: true, count: utilities.length };
  }

  /* -------------------------------------------------------------- invoices */
  function viewInvoices() {
    var filters = filtersFor('invoices');
    var rows = Store.getInvoiceList({
      period: filters.period,
      locationId: filters.locationId,
      status: filters.status,
      tenantId: filters.tenantId || null
    });
    var billed = rows.reduce(function (total, row) { return total + row.total; }, 0);
    var paid = rows.reduce(function (total, row) { return total + row.paid; }, 0);
    var balance = rows.reduce(function (total, row) { return total + row.balance; }, 0);

    var cards = [
      statCard({ icon: 'receipt', tone: 'navy', label: t('invoices.count'), value: F.number(rows.length), meta: F.monthLabel(filters.period === 'all' ? Store.getMeta().currentPeriod : filters.period) }),
      statCard({ icon: 'chart', tone: 'blue', label: t('reports.billed'), value: money(billed), meta: t('invoices.title') }),
      statCard({ icon: 'wallet', tone: 'green', label: t('invoices.paidAmount'), value: money(paid), meta: t('payments.total') }),
      statCard({ icon: 'clock', tone: balance > 0.005 ? 'orange' : 'slate', label: t('invoices.balance'), value: money(balance), meta: t('invoices.totalOutstanding') })
    ];

    var periodOptions = option('all', t('common.all'), filters.period) +
      Store.monthOptions().map(function (period) {
        return option(period, F.monthLabel(period), filters.period);
      }).join('');

    var filtersHtml = filterBar(
      selectField('invoicePeriod', t('invoices.filterPeriod'), periodOptions,
        'data-mgmt-filter="invoices.period"') +
      selectField('invoiceStatus', t('invoices.filterStatus'),
        option('all', t('common.all'), filters.status) +
        INVOICE_FILTER_STATUSES.map(function (status) {
          return statusOption(status, filters.status);
        }).join(''), 'data-mgmt-filter="invoices.status"') +
      selectField('invoiceLocation', t('invoices.filterLocation'),
        locationOptions(filters.locationId, true), 'data-mgmt-filter="invoices.locationId"') +
      searchField('invoices.search')
    );

    var body = rows.length
      ? tableCard([
        { label: t('invoices.number') },
        { label: t('invoices.tenant') },
        { label: t('invoices.room') },
        { label: t('invoices.period') },
        { label: t('invoices.total'), align: 'right' },
        { label: t('invoices.balance'), align: 'right' },
        { label: t('common.status') },
        { label: t('common.actions'), align: 'right' }
      ], rows.map(function (invoice) {
        return '<tr data-search-text="' + esc(normalize(invoice.invoiceNumber + ' ' +
          invoice.tenantName + ' ' + invoice.tenantNameEn + ' ' + invoice.roomLabel + ' ' +
          locationName(invoice.location))) + '">' +
          '<td data-label="' + esc(t('invoices.number')) + '"><button type="button" class="link-button mgmt-link" data-mgmt="invoice-view" data-id="' +
            esc(invoice.id) + '">' + esc(invoice.invoiceNumber) + '</button></td>' +
          cell(t('invoices.tenant'), invoice.tenant ? tenantName(invoice.tenant) : '—') +
          cell(t('invoices.room'), invoice.roomLabel) +
          cell(t('invoices.period'), F.monthLabel(invoice.billingPeriod)) +
          cell(t('invoices.total'), money(invoice.total), 'align-right') +
          cell(t('invoices.balance'), money(invoice.balance), 'align-right' + (invoice.balance > 0.005 ? ' text-danger' : '')) +
          '<td data-label="' + esc(t('common.status')) + '">' + UI.statusBadge(invoice.displayStatus, t) + '</td>' +
          '<td data-label="' + esc(t('common.actions')) + '" class="align-right"><div class="row-actions">' +
            actionButton('invoice-view', invoice.id, 'eye', 'common.view') +
            (invoice.displayStatus !== 'cancelled' && invoice.balance > 0.005
              ? actionButton('invoice-pay', invoice.id, 'wallet', 'invoices.recordPayment')
              : '') +
            (invoice.displayStatus !== 'cancelled' && !(invoice.paid > 0.005)
              ? actionButton('invoice-cancel', invoice.id, 'x', 'invoices.cancel')
              : '') +
          '</div></td>' +
          '</tr>';
      }), emptyState('invoices.empty', 'receipt'))
      : '<div class="card mgmt-table-card">' + emptyState('invoices.empty', 'receipt') + '</div>';

    var tenantChip = '';
    if (filters.tenantId) {
      var tenantRecord = Store.getTenant(filters.tenantId);
      tenantChip = '<div class="mgmt-chip-row"><span class="filter-chip">' +
        esc(t('invoices.tenant')) + ': ' + esc(tenantName(tenantRecord)) +
        '<button type="button" class="chip-close" data-mgmt="invoices-clear-tenant" aria-label="' +
          esc(t('common.reset')) + '">' + icon('x', 13) + '</button></span></div>';
    }

    return summaryGrid(cards) + filtersHtml + tenantChip + '<section class="section">' + body + '</section>';
  }

  function openGenerateForm() {
    var filters = filtersFor('invoices');
    var period = filters.period === 'all' ? Store.getMeta().currentPeriod : filters.period;
    var issueDate = period + '-03';
    if (period === Store.getMeta().currentPeriod && todayIso() < issueDate) issueDate = todayIso();
    var dueDate = F.addMonths(period, 1) + '-05';

    modalForm({
      title: t('invoices.generateTitle'),
      kicker: t('mgmt.phase', { phase: 5 }),
      submitKey: 'invoices.generate',
      intro: t('invoices.generateHint'),
      body:
        formField(t('invoices.filterPeriod'), selectInput('period', Store.monthOptions().map(function (item) {
          return option(item, F.monthLabel(item), period);
        }).join(''))) +
        formField(t('invoices.filterLocation'), selectInput('locationId', locationOptions('all', true))) +
        formField(t('invoices.issueDate'), dateInput('issueDate', issueDate)) +
        formField(t('invoices.dueDate'), dateInput('dueDate', dueDate)) +
        formField(t('invoices.otherCharges'), numberInput('otherCharges', 0)) +
        formField(t('invoices.discount'), numberInput('discount', 0)) +
        '<div class="mgmt-field-wide">' + formField(t('common.notes'), textareaInput('notes', '')) + '</div>',
      onSubmit: function (dialog) {
        var result = Store.generateInvoices({
          period: formValue(dialog, 'period'),
          locationId: formValue(dialog, 'locationId'),
          issueDate: formValue(dialog, 'issueDate'),
          dueDate: formValue(dialog, 'dueDate'),
          otherCharges: formNumber(dialog, 'otherCharges'),
          discount: formNumber(dialog, 'discount'),
          notes: formValue(dialog, 'notes')
        });
        if (!result || result.ok === false) {
          UI.toast(errorText(result), 'error');
          return;
        }
        var summary = result.result;
        UI.closeModal();
        if (!summary.created) {
          UI.toast(t('invoices.noCreated'), 'info');
        } else {
          UI.toast(t('invoices.generated', { created: summary.created, skipped: summary.skipped }), 'success');
        }
        if (summary.missing.length) {
          UI.toast(t('invoices.missingReadings', { count: summary.missing.length }), 'info');
        }
      }
    });
  }

  function invoiceItemsMarkup(details) {
    return details.items.map(function (item) {
      return '<div class="line-item">' +
        '<div class="line-item-copy"><span>' + esc(t(item.labelKey)) + '</span>' +
          (item.meta ? '<small>' + esc(item.meta) + '</small>' : '') + '</div>' +
        '<span class="line-item-amount ' + (item.amount < 0 ? 'text-success' : '') + '">' +
          money(item.amount) + '</span></div>';
    }).join('');
  }

  function invoicePaymentsMarkup(details) {
    if (!details.payments.length) {
      return '<p class="empty-inline">' + esc(t('invoices.noPayments')) + '</p>';
    }
    return '<div class="payment-list">' + details.payments.map(function (payment) {
      return '<div class="payment-row">' +
        '<div class="payment-main"><strong>' + money(payment.amount) + '</strong>' +
          '<span>' + esc(t('method.' + payment.method)) +
            (payment.reference ? ' • ' + esc(payment.reference) : '') + '</span></div>' +
        '<div class="payment-meta"><span>' + esc(F.date(payment.date)) + '</span>' +
          '<small>' + esc(payment.paymentNumber) + '</small></div>' +
        '</div>';
    }).join('') + '</div>';
  }

  function openInvoiceDetail(invoiceId) {
    var details = Store.getInvoiceDetails(invoiceId);
    if (!details) { UI.toast(t('mgmt.notFound'), 'error'); return; }
    var invoice = details.invoice;
    var canPay = invoice.displayStatus !== 'cancelled' && invoice.balance > 0.005;
    var canCancel = invoice.displayStatus !== 'cancelled' && !(invoice.paid > 0.005);

    var body =
      '<div class="invoice-hero">' +
        '<div><span class="detail-label">' + esc(t('invoices.period')) + '</span>' +
          '<strong>' + esc(F.monthLabel(invoice.billingPeriod)) + '</strong></div>' +
        '<div><span class="detail-label">' + esc(t('invoices.dueDate')) + '</span>' +
          '<strong>' + esc(F.date(invoice.dueDate)) + '</strong></div>' +
        '<div class="invoice-hero-total"><span>' + esc(t('invoices.total')) + '</span>' +
          '<strong>' + money(invoice.total) + '</strong>' +
          UI.statusBadge(invoice.displayStatus, t) + '</div>' +
      '</div>' +
      '<div class="detail-meta-grid">' +
        detailItem(t('invoices.tenant'), invoice.tenant ? tenantName(invoice.tenant) : '—') +
        detailItem(t('invoices.room'), invoice.roomLabel) +
        detailItem(t('details.property'), locationName(invoice.location)) +
        detailItem(t('details.phone'), invoice.tenant ? F.phone(invoice.tenant.phone) : '—') +
        detailItem(t('invoices.issueDate'), F.date(invoice.issueDate)) +
        detailItem(t('invoices.dueDate'), F.date(invoice.dueDate)) +
      '</div>' +
      '<div class="detail-section"><h3>' + esc(t('invoices.breakdown')) + '</h3>' +
        '<div class="line-items">' + invoiceItemsMarkup(details) + '</div>' +
        '<div class="line-totals">' +
          '<div><span>' + esc(t('invoices.paidAmount')) + '</span><span class="text-success">' +
            money(invoice.paid) + '</span></div>' +
          '<div class="line-total"><span>' + esc(t('invoices.balance')) + '</span><span>' +
            money(invoice.balance) + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="detail-section"><h3>' + esc(t('invoices.paymentsTitle')) + '</h3>' +
        invoicePaymentsMarkup(details) + '</div>';

    UI.modal({
      title: invoice.invoiceNumber,
      kicker: t('invoices.detailTitle'),
      subtitle: (invoice.tenant ? tenantName(invoice.tenant) : '') + ' • ' +
        t('invoices.room') + ' ' + invoice.roomLabel,
      size: 'lg',
      body: body,
      footer:
        '<button type="button" class="button button-ghost" data-mgmt="invoice-copy" data-id="' +
          esc(invoice.id) + '">' + icon('copy', 15) + '<span>' + esc(t('invoices.copyNumber')) + '</span></button>' +
        '<button type="button" class="button button-ghost" data-mgmt="invoice-edit" data-id="' +
          esc(invoice.id) + '">' + esc(t('common.edit')) + '</button>' +
        (canCancel ? '<button type="button" class="button button-ghost" data-mgmt="invoice-cancel" data-id="' +
          esc(invoice.id) + '">' + esc(t('invoices.cancel')) + '</button>' : '') +
        (canPay ? '<button type="button" class="button button-primary" data-mgmt="invoice-pay" data-id="' +
          esc(invoice.id) + '">' + icon('wallet', 16) + '<span>' + esc(t('invoices.recordPayment')) + '</span></button>'
          : '<button type="button" class="button button-primary" data-close-modal>' +
            esc(t('common.close')) + '</button>'),
      onOpen: function (dialog) {
        var close = dialog.querySelector('[data-close-modal]');
        if (close) close.addEventListener('click', UI.closeModal);
      }
    });
  }

  function openInvoiceEdit(invoiceId) {
    var invoice = Store.getInvoice(invoiceId);
    if (!invoice) { UI.toast(t('mgmt.notFound'), 'error'); return; }
    modalForm({
      title: t('invoices.editTitle'),
      kicker: invoice.invoiceNumber,
      submitKey: 'common.update',
      body:
        formField(t('invoices.otherCharges'), numberInput('otherCharges', invoice.otherCharges)) +
        formField(t('invoices.discount'), numberInput('discount', invoice.discount)) +
        formField(t('invoices.lateFee'), numberInput('lateFee', invoice.lateFee)) +
        formField(t('invoices.previousBalance'), numberInput('previousBalance', invoice.previousBalance)) +
        formField(t('invoices.dueDate'), dateInput('dueDate', invoice.dueDate)) +
        '<div class="mgmt-field-wide">' + formField(t('common.notes'), textareaInput('notes', invoice.notes)) + '</div>',
      onSubmit: function (dialog) {
        var result = Store.updateInvoice(invoice.id, {
          otherCharges: formNumber(dialog, 'otherCharges'),
          discount: formNumber(dialog, 'discount'),
          lateFee: formNumber(dialog, 'lateFee'),
          previousBalance: formNumber(dialog, 'previousBalance'),
          dueDate: formValue(dialog, 'dueDate'),
          notes: formValue(dialog, 'notes')
        });
        if (handleResult(result, 'mgmt.updated')) UI.closeModal();
      }
    });
  }

  function outstandingInvoices() {
    return Store.getInvoiceList({ period: 'all', status: 'all' }).filter(function (invoice) {
      return invoice.displayStatus !== 'cancelled' && invoice.balance > 0.005;
    });
  }

  function openPaymentForm(invoiceId) {
    var preset = invoiceId ? Store.getInvoice(invoiceId) : null;
    var list = outstandingInvoices();
    if (!preset && !list.length) {
      UI.toast(t('invoices.noOutstanding'), 'info');
      return;
    }
    var invoiceOptions = list.map(function (invoice) {
      return option(invoice.id, invoice.invoiceNumber + ' • ' +
        (invoice.tenant ? tenantName(invoice.tenant) : '') + ' • ' + money(invoice.balance), invoiceId || '');
    }).join('');

    var handle = modalForm({
      title: t('payments.formTitle'),
      kicker: preset ? preset.invoiceNumber : t('mgmt.phase', { phase: 5 }),
      submitKey: 'payments.add',
      body:
        (preset
          ? '<div class="mgmt-field-wide"><div class="pay-summary">' +
            '<div><small>' + esc(t('invoices.tenant')) + '</small><strong>' +
              esc(preset.tenant ? tenantName(preset.tenant) : '—') + '</strong></div>' +
            '<div><small>' + esc(t('invoices.room')) + '</small><strong>' + esc(preset.roomLabel) + '</strong></div>' +
            '<div><small>' + esc(t('invoices.balance')) + '</small><strong class="text-danger">' +
              money(preset.balance) + '</strong></div>' +
            '</div></div>'
          : formField(t('invoices.selectInvoice'), selectInput('invoiceId', invoiceOptions))) +
        formField(t('payments.amount'), numberInput('amount', preset ? preset.balance : '')) +
        formField(t('payments.date'), dateInput('date', todayIso())) +
        formField(t('payments.method'), selectInput('method', PAYMENT_METHODS.map(function (method) {
          return option(method, t('method.' + method), 'cash');
        }).join(''))) +
        formField(t('payments.reference'), textInput('reference', '')) +
        '<div class="mgmt-field-wide">' + formField(t('payments.notes'), textareaInput('notes', '')) + '</div>',
      onSubmit: function (dialog) {
        var result = Store.recordPayment({
          invoiceId: preset ? preset.id : formValue(dialog, 'invoiceId'),
          amount: formNumber(dialog, 'amount'),
          date: formValue(dialog, 'date'),
          method: formValue(dialog, 'method'),
          reference: formValue(dialog, 'reference'),
          notes: formValue(dialog, 'notes')
        });
        if (handleResult(result, 'payments.saved')) UI.closeModal();
      }
    });

    if (!preset && handle && handle.dialog) {
      var invoiceSelect = handle.dialog.querySelector('[name="invoiceId"]');
      var amountInput = handle.dialog.querySelector('[name="amount"]');
      if (invoiceSelect && amountInput) {
        invoiceSelect.addEventListener('change', function () {
          var invoice = Store.getInvoice(invoiceSelect.value);
          if (invoice) amountInput.value = invoice.balance;
        });
      }
    }
  }

  /* -------------------------------------------------------------- payments */
  function viewPayments() {
    var filters = filtersFor('payments');
    var rows = Store.getPaymentList({ period: filters.period, method: filters.method });
    var total = rows.reduce(function (sum, row) { return sum + Number(row.payment.amount); }, 0);
    var cash = rows.filter(function (row) { return row.payment.method === 'cash'; }).length;
    var transfers = rows.length - cash;

    var cards = [
      statCard({ icon: 'wallet', tone: 'green', label: t('payments.total'), value: money(total), meta: F.monthLabel(filters.period === 'all' ? Store.getMeta().currentPeriod : filters.period) }),
      statCard({ icon: 'receipt', tone: 'navy', label: t('payments.invoice'), value: F.number(rows.length), meta: t('mgmt.showingCount', { count: rows.length }) }),
      statCard({ icon: 'home', tone: 'blue', label: t('method.cash'), value: F.number(cash), meta: t('payments.method') }),
      statCard({ icon: 'chart', tone: 'slate', label: t('method.bank_transfer'), value: F.number(transfers), meta: t('payments.method') })
    ];

    var periodOptions = option('all', t('common.all'), filters.period) +
      Store.monthOptions().map(function (period) {
        return option(period, F.monthLabel(period), filters.period);
      }).join('');

    var filtersHtml = filterBar(
      selectField('paymentPeriod', t('payments.filterPeriod'), periodOptions,
        'data-mgmt-filter="payments.period"') +
      selectField('paymentMethod', t('payments.filterMethod'),
        option('all', t('common.all'), filters.method) +
        PAYMENT_METHODS.map(function (method) {
          return option(method, t('method.' + method), filters.method);
        }).join(''), 'data-mgmt-filter="payments.method"') +
      searchField('payments.search')
    );

    var body = rows.length
      ? tableCard([
        { label: t('payments.number') },
        { label: t('payments.date') },
        { label: t('payments.invoice') },
        { label: t('payments.tenant') },
        { label: t('payments.room') },
        { label: t('payments.method') },
        { label: t('payments.amount'), align: 'right' },
        { label: t('common.actions'), align: 'right' }
      ], rows.map(function (row) {
        var payment = row.payment;
        return '<tr data-search-text="' + esc(normalize(payment.paymentNumber + ' ' +
          (row.invoice ? row.invoice.invoiceNumber : '') + ' ' + tenantName(row.tenant) + ' ' +
          (row.room ? row.room.number : '') + ' ' + payment.reference)) + '">' +
          cell(t('payments.number'), payment.paymentNumber) +
          cell(t('payments.date'), F.date(payment.date)) +
          '<td data-label="' + esc(t('payments.invoice')) + '">' + (row.invoice
            ? '<button type="button" class="link-button mgmt-link" data-mgmt="invoice-view" data-id="' +
              esc(row.invoice.id) + '">' + esc(row.invoice.invoiceNumber) + '</button>'
            : '—') + '</td>' +
          cell(t('payments.tenant'), tenantName(row.tenant)) +
          cell(t('payments.room'), row.room ? row.room.number : '—') +
          cell(t('payments.method'), t('method.' + payment.method)) +
          cell(t('payments.amount'), money(payment.amount), 'align-right text-success') +
          '<td data-label="' + esc(t('common.actions')) + '" class="align-right"><div class="row-actions">' +
            actionButton('payment-del', payment.id, 'x', 'common.delete', 'is-danger') +
          '</div></td>' +
          '</tr>';
      }), emptyState('payments.empty', 'wallet'))
      : '<div class="card mgmt-table-card">' + emptyState('payments.empty', 'wallet') + '</div>';

    return summaryGrid(cards) + filtersHtml + '<section class="section">' + body + '</section>';
  }

  /* --------------------------------------------------------------- reports */
  function viewReports() {
    var filters = filtersFor('reports');
    var data = Store.getReportData(filters.period, filters.locationId);
    state.reportData = data;
    var summary = data.summary;
    var collectionRate = summary.monthlyBilled
      ? (summary.collected / summary.monthlyBilled) * 100
      : 0;

    var cards = [
      statCard({ icon: 'chart', tone: 'blue', label: t('reports.billed'), value: money(summary.monthlyBilled), meta: F.monthLabel(data.period) }),
      statCard({ icon: 'wallet', tone: 'green', label: t('reports.collected'), value: money(summary.collected), meta: F.percent(collectionRate, 0) + ' ' + t('reports.collectionRate') }),
      statCard({ icon: 'clock', tone: 'orange', label: t('reports.outstanding'), value: money(summary.outstanding), meta: F.number(summary.overdueCount) + ' ' + t('status.overdue') }),
      statCard({ icon: 'users', tone: 'navy', label: t('reports.occupancy'), value: F.percent(summary.occupancyRate, 0), meta: F.number(summary.occupiedRooms) + ' / ' + F.number(summary.totalRooms) + ' ' + t('common.rooms') }),
      statCard({ icon: 'receipt', tone: 'slate', label: t('reports.invoiceCount'), value: F.number(data.invoiceCount), meta: F.monthLabel(data.period) }),
      statCard({ icon: 'home', tone: 'slate', label: t('reports.vacantRate'), value: F.percent(data.vacantRate, 0), meta: F.number(summary.vacantRooms) + ' ' + t('properties.vacant') })
    ];

    var filtersHtml = filterBar(
      selectField('reportPeriod', t('invoices.filterPeriod'), Store.monthOptions().map(function (period) {
        return option(period, F.monthLabel(period), filters.period);
      }).join(''), 'data-mgmt-filter="reports.period"') +
      selectField('reportLocation', t('invoices.filterLocation'),
        locationOptions(filters.locationId, true), 'data-mgmt-filter="reports.locationId"')
    );

    var propertyRows = data.properties.map(function (property) {
      return '<tr>' +
        cell(t('reports.location'), locationName(property.location)) +
        cell(t('reports.rooms'), F.number(property.totalRooms), 'align-right') +
        cell(t('reports.occupancyShort'), F.percent(property.occupancyRate, 0), 'align-right') +
        cell(t('reports.billedShort'), money(property.billed), 'align-right') +
        cell(t('reports.collectedShort'), money(property.collected), 'align-right text-success') +
        cell(t('reports.outstandingShort'), money(property.outstanding), 'align-right' +
          (property.outstanding > 0.005 ? ' text-danger' : '')) +
        '</tr>';
    });

    var outstandingRows = data.topOutstanding.map(function (item) {
      return '<tr>' +
        '<td data-label="' + esc(t('reports.tenant')) + '">' + (item.tenant
          ? '<button type="button" class="link-button mgmt-link" data-mgmt="tenant-view" data-id="' +
            esc(item.tenant.id) + '">' + esc(tenantName(item.tenant)) + '</button>'
          : '—') + '</td>' +
        cell(t('tenants.invoices'), F.number(item.count), 'align-right') +
        cell(t('reports.balance'), money(item.balance), 'align-right text-danger') +
        '</tr>';
    });

    return summaryGrid(cards) + filtersHtml +
      '<section class="section">' +
        '<div class="section-heading"><div><h2>' + esc(t('reports.kpis')) + '</h2>' +
          '<p>' + esc(t('reports.subtitle')) + '</p></div></div>' +
        '<div class="charts-grid mgmt-charts">' +
          '<article class="chart-card chart-revenue">' +
            '<div class="chart-heading"><h3>' + esc(t('reports.revenueChart')) + '</h3>' +
              '<p>' + esc(F.monthLabel(data.period)) + '</p></div>' +
            '<div class="chart-body"><canvas id="reportRevenueChart" role="img" aria-label="' +
              esc(t('reports.revenueChart')) + '"></canvas></div>' +
          '</article>' +
          '<article class="chart-card chart-occupancy">' +
            '<div class="chart-heading"><h3>' + esc(t('reports.methodChart')) + '</h3>' +
              '<p>' + esc(t('payments.paymentCount')) + ': ' + F.number(data.paymentCount) + '</p></div>' +
            '<div class="chart-body chart-doughnut-body"><canvas id="reportMethodChart" role="img" aria-label="' +
              esc(t('reports.methodChart')) + '"></canvas></div>' +
          '</article>' +
          '<article class="chart-card chart-occupancy">' +
            '<div class="chart-heading"><h3>' + esc(t('reports.statusChart')) + '</h3>' +
              '<p>' + esc(t('reports.invoiceCount')) + ': ' + F.number(data.invoiceCount) + '</p></div>' +
            '<div class="chart-body chart-doughnut-body"><canvas id="reportStatusChart" role="img" aria-label="' +
              esc(t('reports.statusChart')) + '"></canvas></div>' +
          '</article>' +
        '</div>' +
      '</section>' +
      '<div class="mgmt-two-col">' +
        '<section class="section">' +
          '<div class="section-heading"><div><h2>' + esc(t('reports.propertyTable')) + '</h2></div></div>' +
          tableCard([
            { label: t('reports.location') },
            { label: t('reports.rooms'), align: 'right' },
            { label: t('reports.occupancyShort'), align: 'right' },
            { label: t('reports.billedShort'), align: 'right' },
            { label: t('reports.collectedShort'), align: 'right' },
            { label: t('reports.outstandingShort'), align: 'right' }
          ], propertyRows, emptyState('reports.empty', 'chart')) +
        '</section>' +
        '<section class="section">' +
          '<div class="section-heading"><div><h2>' + esc(t('reports.topOutstanding')) + '</h2></div></div>' +
          (outstandingRows.length
            ? tableCard([
              { label: t('reports.tenant') },
              { label: t('tenants.invoices'), align: 'right' },
              { label: t('reports.balance'), align: 'right' }
            ], outstandingRows, '')
            : '<div class="card mgmt-table-card">' + emptyState('reports.noOutstanding', 'checkout') + '</div>') +
        '</section>' +
      '</div>';
  }

  function chartDefaults() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            usePointStyle: true,
            pointStyle: 'circle',
            boxWidth: 8,
            boxHeight: 8,
            padding: 14,
            font: { family: "'Noto Sans Khmer', sans-serif", size: 11.5 }
          }
        },
        tooltip: {
          backgroundColor: '#0f2743',
          padding: 11,
          cornerRadius: 9,
          titleFont: { family: "'Noto Sans Khmer', sans-serif", size: 12 },
          bodyFont: { family: "'Noto Sans Khmer', sans-serif", size: 12 }
        }
      }
    };
  }

  function buildReportCharts() {
    if (typeof window.Chart !== 'function' || !state.reportData) return;
    destroyCharts();
    var data = state.reportData;
    var textColor = '#64748b';
    Chart.defaults.font.family = "'Noto Sans Khmer', 'Segoe UI', sans-serif";
    Chart.defaults.font.size = 11.5;
    Chart.defaults.color = textColor;

    var revenueCanvas = document.getElementById('reportRevenueChart');
    if (revenueCanvas) {
      var options = chartDefaults();
      options.plugins.tooltip.callbacks = {
        label: function (context) { return ' ' + context.dataset.label + ': ' + money(context.parsed.y); }
      };
      options.scales = {
        x: { grid: { display: false }, border: { display: false } },
        y: {
          beginAtZero: true,
          grid: { color: '#eef2f8' },
          border: { display: false },
          ticks: { callback: function (value) { return F.compactMoney(value); } }
        }
      };
      charts.revenue = new Chart(revenueCanvas, {
        type: 'bar',
        data: {
          labels: data.revenueSeries.map(function (item) { return F.monthShort(item.period); }),
          datasets: [
            {
              label: t('reports.billedShort'),
              data: data.revenueSeries.map(function (item) { return item.billed; }),
              backgroundColor: '#1d4ed8',
              borderRadius: 6,
              maxBarThickness: 26
            },
            {
              label: t('reports.collectedShort'),
              data: data.revenueSeries.map(function (item) { return item.collected; }),
              backgroundColor: '#0f9d76',
              borderRadius: 6,
              maxBarThickness: 26
            }
          ]
        },
        options: options
      });
    }

    var methodCanvas = document.getElementById('reportMethodChart');
    if (methodCanvas) {
      var methods = Object.keys(data.methodTotals);
      var values = methods.map(function (method) { return data.methodTotals[method]; });
      if (methods.length) {
        var methodOptions = chartDefaults();
        methodOptions.plugins.legend.position = 'bottom';
        methodOptions.plugins.tooltip.callbacks = {
          label: function (context) { return ' ' + context.label + ': ' + money(context.parsed); }
        };
        charts.method = new Chart(methodCanvas, {
          type: 'doughnut',
          data: {
            labels: methods.map(function (method) { return t('method.' + method); }),
            datasets: [{
              data: values,
              backgroundColor: ['#0f9d76', '#1d4ed8', '#f59e0b', '#e11d48', '#64748b'],
              borderWidth: 0,
              hoverOffset: 6
            }]
          },
          options: methodOptions
        });
      }
    }

    var statusCanvas = document.getElementById('reportStatusChart');
    if (statusCanvas) {
      var keys = ['paid', 'partial', 'unpaid', 'overdue'];
      var counts = keys.map(function (key) { return data.statusCounts[key] || 0; });
      if (counts.some(function (value) { return value > 0; })) {
        var statusOptions = chartDefaults();
        statusOptions.plugins.legend.position = 'bottom';
        statusOptions.plugins.tooltip.callbacks = {
          label: function (context) { return ' ' + context.label + ': ' + context.parsed; }
        };
        charts.status = new Chart(statusCanvas, {
          type: 'doughnut',
          data: {
            labels: keys.map(function (key) { return t('status.' + key); }),
            datasets: [{
              data: counts,
              backgroundColor: ['#0f9d76', '#f59e0b', '#64748b', '#e11d48'],
              borderWidth: 0,
              hoverOffset: 6
            }]
          },
          options: statusOptions
        });
      }
    }
  }

  function destroyCharts() {
    Object.keys(charts).forEach(function (key) {
      if (charts[key] && charts[key].destroy) charts[key].destroy();
      delete charts[key];
    });
  }

  function exportReportCsv() {
    var data = state.reportData;
    if (!data) return;
    function csvCell(value) {
      return '"' + String(value === null || value === undefined ? '' : value).replace(/"/g, '""') + '"';
    }
    var lines = [];
    lines.push([t('reports.title'), F.monthLabel(data.period)].map(csvCell).join(','));
    lines.push('');
    lines.push([t('reports.billed'), data.summary.monthlyBilled].map(csvCell).join(','));
    lines.push([t('reports.collected'), data.summary.collected].map(csvCell).join(','));
    lines.push([t('reports.outstanding'), data.summary.outstanding].map(csvCell).join(','));
    lines.push([t('reports.occupancyShort'), data.summary.occupancyRate.toFixed(1)].map(csvCell).join(','));
    lines.push('');
    lines.push([
      t('reports.location'), t('reports.rooms'), t('reports.occupancyShort'),
      t('reports.billedShort'), t('reports.outstandingShort')
    ].map(csvCell).join(','));
    data.properties.forEach(function (property) {
      lines.push([
        locationName(property.location),
        property.totalRooms,
        property.occupancyRate.toFixed(1),
        property.billed,
        property.outstanding
      ].map(csvCell).join(','));
    });
    var ok = download('rrms-report-' + data.period + '.csv', lines.join('\r\n'), 'text/csv;charset=utf-8');
    UI.toast(ok ? t('reports.exported') : t('error.generic'), ok ? 'success' : 'error');
  }

  /* -------------------------------------------------------------- settings */
  function settingsCard(title, subtitle, inner, actions) {
    return '<section class="card mgmt-settings-card">' +
      '<div class="mgmt-settings-head"><div><h2>' + esc(title) + '</h2>' +
        (subtitle ? '<p>' + esc(subtitle) + '</p>' : '') + '</div>' +
        (actions || '') + '</div>' +
      inner +
      '</section>';
  }

  function viewSettings() {
    var settings = Store.getSettings();
    var counts = {
      locations: Store.getLocations().length,
      rooms: Store.getRooms().length,
      tenants: Store.getTenants().length,
      tenancies: Store.getTenancies().length,
      invoices: Store.getInvoices().length,
      payments: Store.getPayments().length,
      readings: Store.getReadings().length
    };

    var company =
      '<div class="form-grid" data-settings-form>' +
        formField(t('settings.companyNameKm'), textInput('companyNameKm', settings.companyNameKm)) +
        formField(t('settings.companyNameEn'), textInput('companyNameEn', settings.companyNameEn)) +
        formField(t('settings.currency'), selectInput('currency',
          option('USD', t('common.currencyUsd'), settings.currency) +
          option('KHR', t('common.currencyKhr'), settings.currency))) +
        formField(t('settings.secondaryCurrency'), selectInput('secondaryCurrency',
          option('KHR', t('common.currencyKhr'), settings.secondaryCurrency) +
          option('USD', t('common.currencyUsd'), settings.secondaryCurrency))) +
        formField(t('settings.exchangeRate'), numberInput('exchangeRateKhr', settings.exchangeRateKhr, '1', 0)) +
        formField(t('settings.dateFormat'), textInput('dateFormat', settings.dateFormat)) +
      '</div>';

    var billing =
      '<div class="form-grid" data-settings-billing>' +
        formField(t('settings.electricityRate'), numberInput('defaultElectricityRate', settings.defaultElectricityRate)) +
        formField(t('settings.waterRate'), numberInput('defaultWaterRate', settings.defaultWaterRate)) +
        formField(t('settings.monthlyRent'), numberInput('defaultMonthlyRent', settings.defaultMonthlyRent, '0.01', 0)) +
        formField(t('settings.dueDay'), numberInput('invoiceDueDay', settings.invoiceDueDay, '1', 1)) +
      '</div>';

    var language =
      '<div class="form-grid" data-settings-language>' +
        formField(t('settings.defaultLanguage'), selectInput('defaultLanguage',
          option('km', t('lang.km'), settings.defaultLanguage) +
          option('en', t('lang.en'), settings.defaultLanguage)), t('settings.languageHint')) +
        '<div class="mgmt-field mgmt-field-wide">' +
          '<span class="field-label">' + esc(t('settings.language')) + '</span>' +
          '<div class="lang-segment lang-segment-wide" role="group">' +
            '<button type="button" data-mgmt="settings-lang" data-id="km"' +
              (lang() === 'km' ? ' class="is-active"' : '') + '>' + esc(t('lang.km')) + '</button>' +
            '<button type="button" data-mgmt="settings-lang" data-id="en"' +
              (lang() === 'en' ? ' class="is-active"' : '') + '>' + esc(t('lang.en')) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    var dataButtons =
      '<div class="mgmt-settings-actions">' +
        '<button type="button" class="button button-secondary button-icon-text" data-mgmt="settings-export">' +
          icon('download', 16) + '<span>' + esc(t('settings.export')) + '</span></button>' +
        '<button type="button" class="button button-secondary button-icon-text" data-mgmt="settings-import">' +
          icon('fileText', 16) + '<span>' + esc(t('settings.import')) + '</span></button>' +
        '<button type="button" class="button button-ghost button-icon-text is-danger" data-mgmt="settings-reset">' +
          icon('refresh', 16) + '<span>' + esc(t('settings.reset')) + '</span></button>' +
        '<input type="file" accept=".json,application/json" data-import-file class="sr-only" tabindex="-1">' +
      '</div>';

    var countCells = Object.keys(counts).map(function (key) {
      return '<div class="mgmt-count"><strong>' + F.number(counts[key]) + '</strong>' +
        '<small>' + esc(t('settings.' + key)) + '</small></div>';
    }).join('');

    var dataCard = settingsCard(
      t('settings.data'),
      t('settings.demoModeBody'),
      '<div class="demo-box mgmt-data-box">' +
        '<span class="demo-box-icon">' + icon('info', 18) + '</span>' +
        '<div><strong>' + esc(t('settings.demoMode')) + '</strong>' +
          '<p>' + esc(t('settings.storageNote')) + '</p></div>' +
      '</div>' +
      '<div class="mgmt-counts">' + countCells + '</div>' + dataButtons
    );

    var aboutCard = settingsCard(
      t('settings.aboutTitle'),
      t('app.tagline'),
      '<div class="detail-meta-grid">' +
        detailItem(t('settings.version'), RRMS.Config.version) +
        detailItem(t('settings.phase'), String(RRMS.Config.phase)) +
        detailItem(t('settings.dataSource'), t('settings.dataSourceDemo')) +
        detailItem(t('app.short'), RRMS.Config.appName(lang())) +
      '</div>'
    );

    return '<section class="section mgmt-settings-grid">' +
        settingsCard(t('settings.company'), t('locations.subtitle'), company) +
        '<div class="mgmt-settings-col">' +
          settingsCard(t('settings.billing'), t('locations.rates'), billing,
            '<button type="button" class="button button-primary button-small" data-mgmt="settings-save">' +
              esc(t('common.save')) + '</button>') +
          settingsCard(t('settings.language'), t('settings.languageHint'), language) +
        '</div>' +
        dataCard +
        aboutCard +
      '</section>';
  }

  function saveSettings() {
    if (!moduleEl) return;
    function value(name) {
      var node = moduleEl.querySelector('[name="' + name + '"]');
      return node ? node.value : '';
    }
    function numeric(name) {
      var number = Number(value(name));
      return isFinite(number) ? number : 0;
    }
    var result = Store.updateSettings({
      companyNameKm: value('companyNameKm'),
      companyNameEn: value('companyNameEn'),
      currency: value('currency'),
      secondaryCurrency: value('secondaryCurrency'),
      exchangeRateKhr: numeric('exchangeRateKhr'),
      dateFormat: value('dateFormat'),
      defaultElectricityRate: numeric('defaultElectricityRate'),
      defaultWaterRate: numeric('defaultWaterRate'),
      defaultMonthlyRent: numeric('defaultMonthlyRent'),
      invoiceDueDay: numeric('invoiceDueDay'),
      defaultLanguage: value('defaultLanguage')
    });
    handleResult(result, 'settings.saved');
  }

  function exportAllData() {
    var content = Store.exportData();
    var ok = download('rrms-data-' + todayIso() + '.json', content, 'application/json');
    UI.toast(ok ? t('settings.exported') : t('error.generic'), ok ? 'success' : 'error');
  }

  function readImportFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var result = Store.importData(String(reader.result || ''));
      if (result.ok) {
        UI.toast(t('settings.imported'), 'success');
      } else {
        UI.toast(t('settings.importInvalid'), 'error');
      }
    };
    reader.onerror = function () { UI.toast(t('settings.importInvalid'), 'error'); };
    reader.readAsText(file);
  }

  /* -------------------------------------------------------------- actions */
  var suspendRefresh = false;

  function handleAction(action, id) {
    if (action === 'loc-add') return openLocationForm();
    if (action === 'loc-edit') return openLocationForm(id);
    if (action === 'loc-del') return confirmLocationDelete(id);
    if (action === 'loc-rooms') {
      filtersFor('rooms').locationId = id;
      return navigate('rooms');
    }

    if (action === 'room-add') return openRoomForm();
    if (action === 'room-edit') return openRoomForm(id);
    if (action === 'room-view') return openRoomDetail(id);
    if (action === 'room-del') return confirmRoomDelete(id);
    if (action === 'room-assign') return openTenancyForm({ roomId: id });

    if (action === 'tenant-add') return openTenantForm();
    if (action === 'tenant-edit') return openTenantForm(id);
    if (action === 'tenant-view') return openTenantDetail(id);
    if (action === 'tenant-del') return confirmTenantDelete(id);
    if (action === 'tenant-assign') return openTenancyForm({ tenantId: id });
    if (action === 'invoices-filter-tenant') {
      filtersFor('invoices').tenantId = id;
      filtersFor('invoices').period = 'all';
      filtersFor('invoices').status = 'all';
      return navigate('invoices');
    }
    if (action === 'invoices-clear-tenant') {
      filtersFor('invoices').tenantId = null;
      return renderModule('invoices');
    }

    if (action === 'tenancy-add') return openTenancyForm();
    if (action === 'tenancy-end') return openEndTenancy(id);
    if (action === 'tenancy-del') return confirmTenancyDelete(id);

    if (action === 'reading-save') {
      var row = moduleEl.querySelector('[data-meter-row][data-room-id="' + id + '"]');
      if (!row) return;
      var result = saveMeterRow(row);
      if (!result.ok && result.code === 'needValue') {
        UI.toast(t('meters.needValue'), 'error');
      } else {
        handleResult(result, 'meters.saved');
      }
      return;
    }
    if (action === 'reading-save-all') return saveAllReadings();

    if (action === 'invoice-generate') return openGenerateForm();
    if (action === 'invoice-view') return openInvoiceDetail(id);
    if (action === 'invoice-edit') return openInvoiceEdit(id);
    if (action === 'invoice-pay') return openPaymentForm(id);
    if (action === 'invoice-pay-new') return openPaymentForm();
    if (action === 'invoice-cancel') return confirmInvoiceCancel(id);
    if (action === 'invoice-copy') {
      var invoice = Store.getInvoice(id);
      if (!invoice) return;
      UI.copy(invoice.invoiceNumber).then(function (ok) {
        UI.toast(ok ? t('invoices.copied') : t('common.error'), ok ? 'success' : 'error');
      });
      return;
    }

    if (action === 'payment-add') return openPaymentForm();
    if (action === 'payment-del') return confirmPaymentDelete(id);

    if (action === 'report-csv') return exportReportCsv();
    if (action === 'report-print') { window.print(); return; }

    if (action === 'settings-save') return saveSettings();
    if (action === 'settings-export') return exportAllData();
    if (action === 'settings-import') {
      var input = moduleEl.querySelector('[data-import-file]');
      if (input) input.click();
      return;
    }
    if (action === 'settings-reset') return confirmReset();
    if (action === 'settings-lang') {
      if (I18n.getLanguage() !== id) I18n.setLanguage(id);
      return;
    }
  }

  function saveAllReadings() {
    if (!moduleEl) return;
    var rows = moduleEl.querySelectorAll('[data-meter-row]');
    var saved = 0;
    var error = null;
    suspendRefresh = true;
    rows.forEach(function (row) {
      if (!Object.keys(collectReadingValues(row)).length) return;
      var result = saveMeterRow(row);
      if (result.ok) saved += 1;
      else if (!error) error = result;
    });
    suspendRefresh = false;
    renderModule('meters');
    if (error) UI.toast(errorText(error), 'error');
    else if (saved) UI.toast(t('meters.saved'), 'success');
    else UI.toast(t('meters.needValue'), 'info');
  }

  function confirmLocationDelete(id) {
    var location = Store.getLocation(id);
    if (!location) return;
    confirmAction({
      titleKey: 'locations.deleteTitle',
      bodyParams: { name: locationName(location) },
      onConfirm: function () {
        var result = Store.deleteLocation(id);
        if (result.ok) UI.toast(t('mgmt.deleted'), 'success');
        else if (result.code === 'locationHasRooms') UI.toast(errorText(result), 'error');
        else UI.toast(errorText(result), 'error');
      }
    });
  }

  function confirmRoomDelete(id) {
    var room = Store.getRoom(id);
    if (!room) return;
    confirmAction({
      titleKey: 'rooms.deleteTitle',
      bodyParams: { name: room.number },
      onConfirm: function () {
        var result = Store.deleteRoom(id);
        if (result.ok) UI.toast(t('mgmt.deleted'), 'success');
        else UI.toast(errorText(result), 'error');
      }
    });
  }

  function confirmTenantDelete(id) {
    var tenant = Store.getTenant(id);
    if (!tenant) return;
    confirmAction({
      titleKey: 'tenants.deleteTitle',
      bodyParams: { name: tenantName(tenant) },
      onConfirm: function () {
        var result = Store.deleteTenant(id);
        if (result.ok) UI.toast(t('mgmt.deleted'), 'success');
        else UI.toast(errorText(result), 'error');
      }
    });
  }

  function confirmTenancyDelete(id) {
    var tenancy = Store.getTenancies().find(function (item) { return item.id === id; });
    if (!tenancy) return;
    var tenant = Store.getTenant(tenancy.tenantId);
    confirmAction({
      titleKey: 'tenancies.deleteTitle',
      bodyParams: { name: tenantName(tenant) },
      onConfirm: function () {
        var result = Store.deleteTenancy(id);
        if (result.ok) UI.toast(t('mgmt.deleted'), 'success');
        else UI.toast(errorText(result), 'error');
      }
    });
  }

  function confirmInvoiceCancel(id) {
    var invoice = Store.getInvoice(id);
    if (!invoice) return;
    confirmAction({
      titleKey: 'invoices.cancelTitle',
      bodyKey: 'invoices.cancelBody',
      confirmKey: 'invoices.cancel',
      onConfirm: function () {
        var result = Store.cancelInvoice(id);
        if (result.ok) UI.toast(t('invoices.cancelled'), 'success');
        else UI.toast(errorText(result), 'error');
      }
    });
  }

  function confirmPaymentDelete(id) {
    var payment = Store.getPayments().find(function (item) { return item.id === id; });
    if (!payment) return;
    confirmAction({
      titleKey: 'payments.deleteTitle',
      bodyParams: { name: payment.paymentNumber },
      onConfirm: function () {
        var result = Store.deletePayment(id);
        if (result.ok) UI.toast(t('payments.deleted'), 'success');
        else UI.toast(errorText(result), 'error');
      }
    });
  }

  function confirmReset() {
    confirmAction({
      titleKey: 'settings.resetTitle',
      bodyKey: 'settings.resetBody',
      confirmKey: 'settings.reset',
      danger: true,
      onConfirm: function () {
        Store.resetDemoData();
        UI.toast(t('settings.saved'), 'success');
      }
    });
  }

  /* --------------------------------------------------------------- events */
  function bindEvents() {
    document.addEventListener('click', function (event) {
      var button = event.target.closest('[data-mgmt]');
      if (!button || button.disabled) return;
      event.preventDefault();
      handleAction(button.getAttribute('data-mgmt'), button.getAttribute('data-id') || '');
    });

    document.addEventListener('change', function (event) {
      var select = event.target.closest('[data-mgmt-filter]');
      if (select) {
        var path = select.getAttribute('data-mgmt-filter').split('.');
        var group = filtersFor(path[0]);
        group[path[1]] = select.value;
        renderModule(state.route);
        return;
      }
      var file = event.target.closest('[data-import-file]');
      if (file && file.files && file.files.length) {
        readImportFile(file.files[0]);
        file.value = '';
      }
    });

    document.addEventListener('input', function (event) {
      var search = event.target.closest('[data-live-search]');
      if (search) {
        var view = search.closest('.mgmt-view');
        if (!view) return;
        var query = normalize(search.value);
        view.querySelectorAll('[data-search-text]').forEach(function (node) {
          node.classList.toggle('is-filtered-out',
            !!query && normalize(node.getAttribute('data-search-text')).indexOf(query) === -1);
        });
        return;
      }

      var input = event.target.closest('[data-reading]');
      if (input) {
        var row = input.closest('[data-meter-row]');
        if (!row) return;
        var utility = input.getAttribute('data-reading');
        var previous = Number(input.getAttribute('data-prev')) || 0;
        var rate = Number(input.getAttribute('data-rate')) || 0;
        var usageNode = row.querySelector('[data-usage="' + utility + '"]');
        var amountNode = row.querySelector('[data-amount="' + utility + '"]');
        if (String(input.value).trim() === '') {
          if (usageNode) usageNode.textContent = '—';
          if (amountNode) amountNode.textContent = '—';
          return;
        }
        var current = Number(input.value);
        var usage = Math.max(current - previous, 0);
        if (usageNode) usageNode.textContent = F.number(usage, 2);
        if (amountNode) amountNode.textContent = money(usage * rate);
      }
    });

    window.addEventListener('hashchange', function () {
      var route = parseHash();
      applyRoute(route);
      if (typeof pendingAfter === 'function') {
        var after = pendingAfter;
        pendingAfter = null;
        after();
      }
    });

    document.addEventListener('rrms:data-change', function () {
      if (suspendRefresh) return;
      if (state.route === 'dashboard') return;
      renderModule(state.route);
    });

    document.addEventListener('rrms:language', function () {
      if (state.route === 'dashboard') return;
      renderModule(state.route);
    });
  }

  /* ------------------------------------------------------------------ api */
  function init() {
    if (initialized) return;
    initialized = true;
    I18n = RRMS.I18n;
    Store = RRMS.Store;
    F = RRMS.Format;
    UI = RRMS.UI;
    Icons = RRMS.Icons;

    moduleEl = document.getElementById('moduleView');
    dashboardEl = document.getElementById('dashboardView');
    state.filters = defaults();

    bindEvents();
    applyRoute(parseHash());
  }

  function openCreate(route) {
    var target = ALIASES[route] || route;
    if (!ROUTES[target]) return;
    navigate(target, function () {
      if (target === 'locations') openLocationForm();
      else if (target === 'rooms') openRoomForm();
      else if (target === 'tenants') openTenantForm();
      else if (target === 'tenancies') openTenancyForm();
      else if (target === 'invoices') openGenerateForm();
      else if (target === 'payments') openPaymentForm();
      else if (target === 'meters') {
        var first = moduleEl.querySelector('[data-reading]');
        if (first) first.focus();
      }
    });
  }

  function openEntity(type, id) {
    if (type === 'invoice') openInvoiceDetail(id);
    else if (type === 'room') openRoomDetail(id);
    else if (type === 'tenant') openTenantDetail(id);
    else if (type === 'location') navigate('locations');
  }

  RRMS.Manager = {
    init: init,
    navigate: navigate,
    openCreate: openCreate,
    openEntity: openEntity,
    getRoute: function () { return state.route; },
    isModuleActive: function () { return state.route !== 'dashboard'; }
  };
})();
