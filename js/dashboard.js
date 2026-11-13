/* ==========================================================================
   RRMS — Dashboard page controller
   Renders the Khmer dashboard, filters, charts, invoice details and reminders
   from Store aggregates only. No totals are hardcoded.
   ========================================================================== */
(function () {
  'use strict';

  window.RRMS = window.RRMS || {};

  var I18n, Store, F, UI, Icons;
  var state = { period: null, locationId: 'all' };
  var charts = {};
  var latest = null;

  function t(key, params) { return I18n.t(key, params); }
  function langPick(km, en) { return I18n.getLanguage() === 'en' ? en : km; }
  function esc(value) { return UI.esc(value); }
  function icon(name, size) { return Icons.svg(name, size); }

  function statusBadge(status) { return UI.statusBadge(status, t); }

  function monthOptions() {
    return Store.monthOptions();
  }

  function buildFilters() {
    var monthSelect = document.getElementById('monthFilter');
    var locationSelect = document.getElementById('locationFilter');
    if (!monthSelect || !locationSelect) return;

    monthSelect.innerHTML = monthOptions().map(function (period) {
      return '<option value="' + esc(period) + '">' + esc(F.monthLabel(period)) + '</option>';
    }).join('');
    monthSelect.value = state.period;

    locationSelect.innerHTML = '<option value="all">' + esc(t('dashboard.allLocations')) + '</option>' +
      Store.getLocations().map(function (location) {
        return '<option value="' + esc(location.id) + '">' +
          esc(langPick(location.nameKm, location.nameEn)) + '</option>';
      }).join('');
    locationSelect.value = state.locationId;
  }

  function updateQuickFilters(currentPeriod) {
    var previous = F.addMonths(currentPeriod, -1);
    document.querySelectorAll('[data-quick]').forEach(function (button) {
      var quick = button.getAttribute('data-quick');
      button.classList.toggle('is-active',
        (quick === 'current' && state.period === currentPeriod) ||
        (quick === 'last' && state.period === previous));
    });
  }

  function trendMarkup(trend) {
    if (!trend || trend.direction === 'flat') {
      return '<span class="stat-trend is-flat">' + esc(t('stats.noChange')) + '</span>';
    }
    var up = trend.direction === 'up';
    return '<span class="stat-trend ' + (up ? 'is-up' : 'is-down') + '">' +
      icon(up ? 'arrowUp' : 'arrowDown', 13) +
      '<span>' + F.percent(trend.percent, 1) + '</span>' +
      '<span class="stat-trend-context">' + esc(t('stats.vsLastMonth')) + '</span>' +
      '</span>';
  }

  function renderSummary() {
    var grid = document.getElementById('summaryGrid');
    if (!grid || !latest) return;
    var s = latest.summary;
    var asOf = t('stats.asOf', { month: F.monthLabel(latest.period) });
    var cards = [
      { key: 'totalLocations', icon: 'building', tone: 'navy', value: F.number(s.totalLocations), meta: asOf },
      { key: 'totalRooms', icon: 'door', tone: 'blue', value: F.number(s.totalRooms), meta: asOf },
      { key: 'occupiedRooms', icon: 'users', tone: 'green', value: F.number(s.occupiedRooms), meta: F.percent(s.occupancyRate, 0) + ' ' + esc(t('stats.occupancyMeta')) },
      { key: 'vacantRooms', icon: 'home', tone: 'slate', value: F.number(s.vacantRooms), meta: asOf },
      { key: 'monthlyRevenue', icon: 'chart', tone: 'blue', value: F.money(s.monthlyBilled), trend: s.billedTrend, meta: t('stats.billedMeta') },
      { key: 'collected', icon: 'wallet', tone: 'green', value: F.money(s.collected), trend: s.collectedTrend, meta: t('stats.collectedMeta') },
      { key: 'outstanding', icon: 'clock', tone: 'orange', value: F.money(s.outstanding), meta: t('stats.outstandingMeta') },
      { key: 'overdueInvoices', icon: 'warning', tone: 'red', value: F.number(s.overdueCount), meta: t('stats.overdueMeta') }
    ];

    grid.innerHTML = cards.map(function (card) {
      var meta = card.trend ? trendMarkup(card.trend) : '<span class="stat-meta-text">' + card.meta + '</span>';
      return '<article class="stat-card tone-' + card.tone + '">' +
        '<div class="stat-head">' +
          '<span class="stat-icon">' + icon(card.icon, 20) + '</span>' +
          '<span class="stat-label">' + esc(t('stats.' + card.key)) + '</span>' +
        '</div>' +
        '<p class="stat-value">' + card.value + '</p>' +
        '<div class="stat-meta">' + meta + '</div>' +
        '</article>';
    }).join('');
  }

  function renderProperties() {
    var grid = document.getElementById('propertyGrid');
    if (!grid || !latest) return;
    grid.innerHTML = latest.properties.map(function (property) {
      var location = property.location;
      var name = langPick(location.nameKm, location.nameEn);
      var address = langPick(location.addressKm, location.addressEn);
      var rate = Math.round(property.occupancyRate);
      return '<article class="property-card">' +
        '<div class="property-top">' +
          '<span class="property-icon">' + icon('building', 21) + '</span>' +
          '<div class="property-name">' +
            '<h3>' + esc(name) + '</h3>' +
            '<p>' + icon('mapPin', 13) + '<span>' + esc(address) + '</span></p>' +
          '</div>' +
          '<div class="occupancy-ring" style="--pct:' + rate + '" role="img" aria-label="' +
            esc(t('properties.occupancy')) + ' ' + F.percent(property.occupancyRate, 0) + '">' +
            '<span>' + F.percent(property.occupancyRate, 0) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="property-stats">' +
          '<div><span>' + F.number(property.totalRooms) + '</span><small>' + esc(t('properties.totalRooms')) + '</small></div>' +
          '<div><span class="text-success">' + F.number(property.occupied) + '</span><small>' + esc(t('properties.occupied')) + '</small></div>' +
          '<div><span>' + F.number(property.vacant) + '</span><small>' + esc(t('properties.vacant')) + '</small></div>' +
        '</div>' +
        '<div class="property-finance">' +
          '<div><small>' + esc(t('properties.billed')) + '</small><strong>' + F.money(property.billed) + '</strong></div>' +
          '<div><small>' + esc(t('properties.outstanding')) + '</small><strong class="' +
            (property.outstanding > 0 ? 'text-danger' : 'text-success') + '">' + F.money(property.outstanding) + '</strong></div>' +
        '</div>' +
        '<button type="button" class="property-link" data-location-id="' + esc(location.id) + '">' +
          '<span>' + esc(t('properties.viewData')) + '</span>' + icon('arrowRight', 16) +
        '</button>' +
        '</article>';
    }).join('');
  }

  function destroyCharts() {
    Object.keys(charts).forEach(function (key) {
      if (charts[key] && charts[key].destroy) charts[key].destroy();
      delete charts[key];
    });
  }

  function chartBaseOptions() {
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
            padding: 16,
            font: { family: "'Noto Sans Khmer', sans-serif", size: 11.5 }
          }
        },
        tooltip: {
          backgroundColor: '#0f2743',
          padding: 11,
          cornerRadius: 9,
          titleFont: { family: "'Noto Sans Khmer', sans-serif", size: 12 },
          bodyFont: { family: "'Noto Sans Khmer', sans-serif", size: 12 },
          displayColors: true,
          boxPadding: 4
        }
      }
    };
  }

  function renderCharts() {
    if (!latest || typeof window.Chart !== 'function') return;
    destroyCharts();

    var labels = latest.chartPeriods.map(function (period) { return F.monthShort(period); });
    var lang = I18n.getLanguage();
    Chart.defaults.font.family = "'Noto Sans Khmer', 'Segoe UI', sans-serif";
    Chart.defaults.font.size = 11.5;
    Chart.defaults.color = '#64748b';

    var revenueCanvas = document.getElementById('revenueChart');
    if (revenueCanvas) {
      var revenueOptions = chartBaseOptions();
      revenueOptions.plugins.tooltip.callbacks = {
        label: function (context) {
          return ' ' + context.dataset.label + ': ' + F.money(context.parsed.y);
        }
      };
      revenueOptions.scales = {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { font: { family: "'Noto Sans Khmer', sans-serif", size: 10.5 } }
        },
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
          labels: labels,
          datasets: [
            {
              label: t('charts.billed'),
              data: latest.revenueSeries.map(function (item) { return item.billed; }),
              backgroundColor: '#1d4ed8',
              hoverBackgroundColor: '#1e40af',
              borderRadius: 7,
              maxBarThickness: 26
            },
            {
              label: t('charts.collected'),
              data: latest.revenueSeries.map(function (item) { return item.collected; }),
              backgroundColor: '#34d399',
              hoverBackgroundColor: '#10b981',
              borderRadius: 7,
              maxBarThickness: 26
            }
          ]
        },
        options: revenueOptions
      });
    }

    var utilityCanvas = document.getElementById('utilityChart');
    if (utilityCanvas) {
      var utilityOptions = chartBaseOptions();
      utilityOptions.plugins.tooltip.callbacks = {
        label: function (context) {
          var unit = context.dataset.yAxisID === 'y1' ? t('common.m3') : t('common.kwh');
          return ' ' + context.dataset.label + ': ' + F.number(context.parsed.y, 0) + ' ' + unit;
        }
      };
      utilityOptions.scales = {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { font: { family: "'Noto Sans Khmer', sans-serif", size: 10.5 } }
        },
        y: {
          beginAtZero: true,
          position: 'left',
          grid: { color: '#eef2f8' },
          border: { display: false },
          title: {
            display: true,
            text: t('charts.electricity') + ' (' + t('common.kwh') + ')',
            font: { family: "'Noto Sans Khmer', sans-serif", size: 10.5 },
            color: '#94a3b8'
          },
          ticks: { callback: function (value) { return F.number(value, 0); } }
        },
        y1: {
          beginAtZero: true,
          position: 'right',
          grid: { drawOnChartArea: false },
          border: { display: false },
          title: {
            display: true,
            text: t('charts.water') + ' (' + t('common.m3') + ')',
            font: { family: "'Noto Sans Khmer', sans-serif", size: 10.5 },
            color: '#94a3b8'
          },
          ticks: { callback: function (value) { return F.number(value, 0); } }
        }
      };
      charts.utility = new Chart(utilityCanvas, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: t('charts.electricity'),
              data: latest.utilitySeries.map(function (item) { return item.electricity; }),
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245, 158, 11, 0.12)',
              pointBackgroundColor: '#f59e0b',
              pointBorderColor: '#ffffff',
              pointBorderWidth: 1.5,
              pointRadius: 3,
              pointHoverRadius: 5,
              borderWidth: 2.2,
              tension: 0.35,
              fill: true,
              yAxisID: 'y'
            },
            {
              label: t('charts.water'),
              data: latest.utilitySeries.map(function (item) { return item.water; }),
              borderColor: '#0ea5e9',
              backgroundColor: 'rgba(14, 165, 233, 0.10)',
              pointBackgroundColor: '#0ea5e9',
              pointBorderColor: '#ffffff',
              pointBorderWidth: 1.5,
              pointRadius: 3,
              pointHoverRadius: 5,
              borderWidth: 2.2,
              tension: 0.35,
              fill: true,
              yAxisID: 'y1'
            }
          ]
        },
        options: utilityOptions
      });
    }

    var occupancyCanvas = document.getElementById('occupancyChart');
    if (occupancyCanvas) {
      var occupancyOptions = chartBaseOptions();
      occupancyOptions.plugins.legend.position = 'bottom';
      occupancyOptions.plugins.legend.align = 'center';
      occupancyOptions.plugins.tooltip.callbacks = {
        label: function (context) {
          return ' ' + context.label + ': ' + F.number(context.parsed, 0) + ' ' + t('common.rooms');
        }
      };
      occupancyOptions.cutout = '73%';
      charts.occupancy = new Chart(occupancyCanvas, {
        type: 'doughnut',
        data: {
          labels: [t('charts.occupied'), t('charts.vacant'), t('charts.otherStatuses')],
          datasets: [{
            data: [latest.occupancy.occupied, latest.occupancy.vacant, latest.occupancy.other],
            backgroundColor: ['#10b981', '#cbd5e1', '#f59e0b'],
            hoverBackgroundColor: ['#059669', '#94a3b8', '#d97706'],
            borderWidth: 0,
            hoverOffset: 4
          }]
        },
        options: occupancyOptions
      });
    }

    var outstandingCanvas = document.getElementById('outstandingChart');
    if (outstandingCanvas) {
      var outstandingOptions = chartBaseOptions();
      outstandingOptions.plugins.legend.display = false;
      outstandingOptions.plugins.tooltip.callbacks = {
        label: function (context) { return ' ' + F.money(context.parsed.y); }
      };
      outstandingOptions.scales = {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { font: { family: "'Noto Sans Khmer', sans-serif", size: 10.5 } }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#eef2f8' },
          border: { display: false },
          ticks: { callback: function (value) { return F.compactMoney(value); } }
        }
      };
      charts.outstanding = new Chart(outstandingCanvas, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: t('charts.outstanding'),
            data: latest.outstandingSeries.map(function (item) { return item.amount; }),
            backgroundColor: '#f87171',
            hoverBackgroundColor: '#ef4444',
            borderRadius: 7,
            maxBarThickness: 26
          }]
        },
        options: outstandingOptions
      });
    }

    var rate = document.getElementById('occupancyRate');
    if (rate) rate.textContent = F.percent(latest.occupancy.rate, 0);
    // Language-sensitive canvas labels
    if (lang) { /* language is read through t() during chart creation */ }
  }

  function invoiceRow(invoice) {
    var tenantName = invoice.tenant ? langPick(invoice.tenant.nameKm, invoice.tenant.nameEn) : '—';
    var locationName = langPick(invoice.locationNameKm, invoice.locationNameEn);
    return '<tr class="invoice-row" data-invoice-id="' + esc(invoice.id) + '" tabindex="0" role="button">' +
      '<td><span class="invoice-number">' + esc(invoice.invoiceNumber) + '</span>' +
        '<small class="cell-sub">' + esc(F.shortDate(invoice.issueDate)) + '</small></td>' +
      '<td><div class="tenant-cell"><strong>' + esc(tenantName) + '</strong>' +
        '<span>' + esc(t('invoices.room')) + ' ' + esc(invoice.roomLabel) + ' • ' + esc(locationName) + '</span></div></td>' +
      '<td class="align-right"><span class="amount">' + F.money(invoice.total) + '</span></td>' +
      '<td class="align-right"><span class="amount ' + (invoice.balance > 0 ? 'text-danger' : 'text-success') + '">' +
        F.money(invoice.balance) + '</span></td>' +
      '<td>' + statusBadge(invoice.displayStatus) + '</td>' +
      '<td class="cell-arrow">' + icon('chevronRight', 16) + '</td>' +
      '</tr>';
  }

  function invoiceCard(invoice) {
    var tenantName = invoice.tenant ? langPick(invoice.tenant.nameKm, invoice.tenant.nameEn) : '—';
    var locationName = langPick(invoice.locationNameKm, invoice.locationNameEn);
    return '<button type="button" class="invoice-list-card" data-invoice-id="' + esc(invoice.id) + '">' +
      '<span class="invoice-card-top"><span class="invoice-number">' + esc(invoice.invoiceNumber) + '</span>' +
        statusBadge(invoice.displayStatus) + '</span>' +
      '<span class="invoice-card-main"><span class="tenant-cell"><strong>' + esc(tenantName) + '</strong>' +
        '<span>' + esc(t('invoices.room')) + ' ' + esc(invoice.roomLabel) + ' • ' + esc(locationName) + '</span></span>' +
        '<span class="invoice-card-total">' + F.money(invoice.total) + '</span></span>' +
      '<span class="invoice-card-foot"><span>' + esc(F.monthLabel(invoice.billingPeriod)) + '</span>' +
        '<span class="' + (invoice.balance > 0 ? 'text-danger' : 'text-success') + '">' +
          esc(t('invoices.balance')) + ': ' + F.money(invoice.balance) + '</span></span>' +
      '</button>';
  }

  function emptyState(message, iconName) {
    return '<div class="empty-state">' + icon(iconName || 'inbox', 26) +
      '<p>' + esc(message) + '</p></div>';
  }

  function renderInvoices() {
    var body = document.getElementById('invoiceTableBody');
    var cards = document.getElementById('invoiceCardList');
    var count = document.getElementById('invoiceCount');
    if (!latest) return;
    var invoices = latest.recentInvoices;
    if (count) count.textContent = t('invoices.count', { count: invoices.length });

    if (body) {
      body.innerHTML = invoices.length
        ? invoices.map(invoiceRow).join('')
        : '<tr><td colspan="6">' + emptyState(t('common.noData'), 'receipt') + '</td></tr>';
    }
    if (cards) {
      cards.innerHTML = invoices.length
        ? invoices.map(invoiceCard).join('')
        : emptyState(t('common.noData'), 'receipt');
    }
  }

  function renderReminders() {
    var container = document.getElementById('remindersList');
    if (!container || !latest) return;
    if (!latest.reminders.length) {
      container.innerHTML = '<div class="reminder-empty">' +
        '<span class="reminder-empty-icon">' + icon('checkout', 24) + '</span>' +
        '<p>' + esc(t('reminders.empty')) + '</p></div>';
      return;
    }
    container.innerHTML = latest.reminders.map(function (reminder) {
      var title = t(reminder.titleKey, reminder.titleParams);
      var body = t(reminder.bodyKey, reminder.bodyParams);
      return '<button type="button" class="reminder-item" data-reminder-id="' + esc(reminder.id) + '"' +
        (reminder.invoiceId ? ' data-invoice-id="' + esc(reminder.invoiceId) + '"' : '') +
        (reminder.roomId ? ' data-room-id="' + esc(reminder.roomId) + '"' : '') + '>' +
        '<span class="reminder-icon reminder-' + esc(reminder.severity) + '">' + icon(reminder.icon, 18) + '</span>' +
        '<span class="reminder-copy"><strong>' + esc(title) + '</strong><small>' + esc(body) + '</small></span>' +
        '<span class="reminder-chevron">' + icon('chevronRight', 16) + '</span>' +
        '</button>';
    }).join('');
  }

  function render() {
    latest = Store.getDashboard({ period: state.period, locationId: state.locationId });
    var periodLabel = document.getElementById('periodLabel');
    if (periodLabel) periodLabel.textContent = F.monthLabel(state.period);
    renderSummary();
    renderProperties();
    renderCharts();
    renderInvoices();
    renderReminders();
    updateQuickFilters(Store.getMeta().currentPeriod);
  }

  /* ------------------------------------------------------------ details */
  function detailItem(label, value) {
    return '<div class="detail-item"><span>' + esc(label) + '</span><strong>' +
      esc(value === null || value === undefined || value === '' ? '—' : value) + '</strong></div>';
  }

  function paymentRows(payments) {
    if (!payments.length) {
      return '<p class="empty-inline">' + esc(t('invoices.noPayments')) + '</p>';
    }
    return '<div class="payment-list">' + payments.map(function (payment) {
      return '<div class="payment-row">' +
        '<div class="payment-main"><strong>' + F.money(payment.amount) + '</strong>' +
          '<span>' + esc(t('details.method')) + ': ' + esc(t('method.' + payment.method)) + '</span></div>' +
        '<div class="payment-meta"><span>' + esc(F.date(payment.date)) + '</span>' +
          (payment.reference ? '<small>' + esc(payment.reference) + '</small>' : '') + '</div>' +
        '</div>';
    }).join('') + '</div>';
  }

  function openInvoice(invoiceId) {
    var details = Store.getInvoiceDetails(invoiceId);
    if (!details) return;
    var invoice = details.invoice;
    var tenantName = invoice.tenant ? langPick(invoice.tenant.nameKm, invoice.tenant.nameEn) : '—';
    var locationName = langPick(invoice.locationNameKm, invoice.locationNameEn);
    var items = details.items.map(function (item) {
      return '<div class="line-item">' +
        '<div class="line-item-copy"><span>' + esc(t(item.labelKey)) + '</span>' +
          (item.meta ? '<small>' + esc(item.meta) + '</small>' : '') + '</div>' +
        '<span class="line-item-amount ' + (item.amount < 0 ? 'text-success' : '') + '">' +
          F.money(item.amount) + '</span></div>';
    }).join('');

    var body =
      '<div class="invoice-hero">' +
        '<div><span class="detail-label">' + esc(t('invoices.period')) + '</span>' +
          '<strong>' + esc(F.monthLabel(invoice.billingPeriod)) + '</strong></div>' +
        '<div><span class="detail-label">' + esc(t('invoices.dueDate')) + '</span>' +
          '<strong>' + esc(F.date(invoice.dueDate)) + '</strong></div>' +
        '<div class="invoice-hero-total"><span>' + esc(t('invoices.total')) + '</span>' +
          '<strong>' + F.money(invoice.total) + '</strong>' +
          statusBadge(invoice.displayStatus) + '</div>' +
      '</div>' +
      '<div class="detail-meta-grid">' +
        detailItem(t('invoices.tenant'), tenantName) +
        detailItem(t('invoices.room'), invoice.roomLabel) +
        detailItem(t('details.property'), locationName) +
        detailItem(t('details.phone'), invoice.tenant ? F.phone(invoice.tenant.phone) : '—') +
        detailItem(t('invoices.issueDate'), F.date(invoice.issueDate)) +
        detailItem(t('invoices.dueDate'), F.date(invoice.dueDate)) +
      '</div>' +
      '<div class="detail-section">' +
        '<h3>' + esc(t('invoices.breakdown')) + '</h3>' +
        '<div class="line-items">' + items + '</div>' +
        '<div class="line-totals">' +
          '<div><span>' + esc(t('invoices.paidAmount')) + '</span><span class="text-success">' +
            F.money(invoice.paid) + '</span></div>' +
          '<div class="line-total"><span>' + esc(t('invoices.balance')) + '</span><span>' +
            F.money(invoice.balance) + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="detail-section">' +
        '<h3>' + esc(t('invoices.paymentsTitle')) + '</h3>' +
        paymentRows(details.payments) +
      '</div>';

    UI.modal({
      title: invoice.invoiceNumber,
      kicker: t('details.invoiceTitle'),
      subtitle: tenantName + ' • ' + t('invoices.room') + ' ' + invoice.roomLabel,
      body: body,
      footer: '<button type="button" class="button button-ghost" data-copy-invoice>' +
          icon('copy', 16) + '<span>' + esc(t('invoices.copyNumber')) + '</span></button>' +
        '<button type="button" class="button button-primary" data-close-modal>' +
          esc(t('common.close')) + '</button>',
      onOpen: function (dialog) {
        dialog.querySelector('[data-close-modal]').addEventListener('click', UI.closeModal);
        dialog.querySelector('[data-copy-invoice]').addEventListener('click', function () {
          UI.copy(invoice.invoiceNumber).then(function (ok) {
            UI.toast(ok ? t('invoices.copied') : t('common.error'), ok ? 'success' : 'error');
          });
        });
      }
    });
  }

  function openTenant(tenantId) {
    var details = Store.getTenantDetails(tenantId);
    if (!details) return;
    var tenant = details.tenant;
    var name = langPick(tenant.nameKm, tenant.nameEn);
    var room = details.room;
    var location = details.location;
    var openInvoices = details.openInvoices.length
      ? '<div class="mini-invoice-list">' + details.openInvoices.map(function (invoice) {
        return '<button type="button" class="mini-invoice" data-open-invoice="' + esc(invoice.id) + '">' +
          '<span><strong>' + esc(invoice.invoiceNumber) + '</strong>' +
            '<small>' + esc(F.monthLabel(invoice.billingPeriod)) + '</small></span>' +
          '<span class="' + (invoice.balance > 0 ? 'text-danger' : 'text-success') + '">' +
            F.money(invoice.balance) + '</span>' +
          '</button>';
      }).join('') + '</div>'
      : '<p class="empty-inline">' + esc(t('details.noOpenInvoices')) + '</p>';

    var body =
      '<div class="tenant-hero">' +
        '<span class="avatar avatar-hero">' + esc(UI.initials(name)) + '</span>' +
        '<div class="tenant-hero-copy"><strong>' + esc(name) + '</strong>' +
          '<span>' + icon('phone', 14) + ' ' + esc(F.phone(tenant.phone)) + '</span></div>' +
        '<div class="tenant-hero-balance"><small>' + esc(t('stats.outstanding')) + '</small>' +
          '<strong class="' + (details.totalOutstanding > 0 ? 'text-danger' : 'text-success') + '">' +
            F.money(details.totalOutstanding) + '</strong></div>' +
      '</div>' +
      '<div class="detail-meta-grid">' +
        detailItem(t('details.phone'), F.phone(tenant.phone)) +
        detailItem(t('details.email'), tenant.email) +
        detailItem(t('details.idNumber'), tenant.idNumber) +
        detailItem(t('details.emergencyContact'), tenant.emergencyContactName ? tenant.emergencyContactName + ' • ' + F.phone(tenant.emergencyContactPhone) : '—') +
        detailItem(t('details.property'), location ? langPick(location.nameKm, location.nameEn) : '—') +
        detailItem(t('details.roomNumber'), room ? room.number : '—') +
        detailItem(t('details.monthlyRent'), details.tenancy ? F.money(details.tenancy.monthlyRent) + ' ' + t('common.perMonth') : '—') +
        detailItem(t('details.deposit'), details.tenancy ? F.money(details.tenancy.depositAmount) : '—') +
        detailItem(t('details.moveIn'), details.tenancy ? F.date(details.tenancy.startDate) : '—') +
        detailItem(t('details.moveOut'), details.tenancy && details.tenancy.endDate ? F.date(details.tenancy.endDate) : '—') +
        detailItem(t('details.contract'), details.tenancy ? t('status.' + details.tenancy.status) : '—') +
        detailItem(t('details.address'), tenant.addressKm) +
      '</div>' +
      '<div class="detail-section">' +
        '<h3>' + esc(t('details.openInvoices')) + '</h3>' + openInvoices +
      '</div>';

    UI.modal({
      title: name,
      kicker: t('details.tenantTitle'),
      subtitle: room ? t('details.roomNumber') + ' ' + room.number + ' • ' +
        (location ? langPick(location.nameKm, location.nameEn) : '') : '',
      body: body,
      footer: '<button type="button" class="button button-primary" data-close-modal>' +
        esc(t('common.close')) + '</button>',
      onOpen: function (dialog) {
        dialog.querySelector('[data-close-modal]').addEventListener('click', UI.closeModal);
        dialog.querySelectorAll('[data-open-invoice]').forEach(function (button) {
          button.addEventListener('click', function () {
            var id = button.getAttribute('data-open-invoice');
            UI.closeModal();
            window.setTimeout(function () { openInvoice(id); }, 180);
          });
        });
      }
    });
  }

  function openRoom(roomId) {
    var details = Store.getRoomDetails(roomId);
    if (!details) return;
    var room = details.room;
    var location = details.location;
    var tenant = details.tenant;
    var meters = details.meters.map(function (meter) {
      var reading = details.latestReadings[meter.utility];
      var unit = meter.utility === 'electricity' ? t('common.kwh') : t('common.m3');
      return '<div class="meter-row">' +
        '<span class="meter-icon">' + icon(meter.utility === 'electricity' ? 'bolt' : 'drop', 18) + '</span>' +
        '<span class="meter-copy"><strong>' + esc(meter.meterNumber) + '</strong>' +
          '<small>' + esc(t(meter.utility === 'electricity' ? 'details.meterElectricity' : 'details.meterWater')) + '</small></span>' +
        '<span class="meter-reading">' + (reading
          ? esc(F.number(reading.current, 0)) + ' ' + esc(unit) + '<small>' + esc(F.monthShort(reading.period)) + '</small>'
          : esc(t('common.noData'))) + '</span>' +
      '</div>';
    }).join('');

    var currentInvoice = details.currentInvoice
      ? '<button type="button" class="mini-invoice" data-open-invoice="' + esc(details.currentInvoice.id) + '">' +
          '<span><strong>' + esc(details.currentInvoice.invoiceNumber) + '</strong>' +
          '<small>' + esc(F.monthLabel(details.currentInvoice.billingPeriod)) + '</small></span>' +
          '<span class="' + (details.currentInvoice.balance > 0 ? 'text-danger' : 'text-success') + '">' +
            F.money(details.currentInvoice.balance) + '</span></button>'
      : '<p class="empty-inline">' + esc(t('common.noData')) + '</p>';

    var body =
      '<div class="room-hero">' +
        '<span class="room-hero-icon">' + icon('door', 26) + '</span>' +
        '<div class="room-hero-copy"><strong>' + esc(t('details.roomNumber')) + ' ' + esc(room.number) + '</strong>' +
          '<span>' + esc(location ? langPick(location.nameKm, location.nameEn) : '') + ' • ' +
            esc(t('details.floor')) + ' ' + F.number(room.floor) + '</span></div>' +
        statusBadge(room.status) +
      '</div>' +
      '<div class="detail-meta-grid">' +
        detailItem(t('details.roomType'), t('roomType.' + room.type)) +
        detailItem(t('details.monthlyRent'), F.money(room.monthlyRent) + ' ' + t('common.perMonth')) +
        detailItem(t('properties.occupied'), tenant ? langPick(tenant.nameKm, tenant.nameEn) : t('details.noTenant')) +
        detailItem(t('details.phone'), tenant ? F.phone(tenant.phone) : '—') +
        detailItem(t('details.moveIn'), details.tenancy ? F.date(details.tenancy.startDate) : '—') +
        detailItem(t('details.contract'), details.tenancy ? t('status.' + details.tenancy.status) : '—') +
      '</div>' +
      '<div class="detail-section">' +
        '<h3>' + esc(t('nav.meterReadings')) + '</h3>' +
        '<div class="meter-list">' + meters + '</div>' +
      '</div>' +
      '<div class="detail-section">' +
        '<h3>' + esc(t('invoices.period')) + '</h3>' + currentInvoice +
      '</div>';

    UI.modal({
      title: t('details.roomTitle'),
      subtitle: (location ? langPick(location.nameKm, location.nameEn) : '') + ' • ' +
        t('details.roomNumber') + ' ' + room.number,
      body: body,
      footer: '<button type="button" class="button button-primary" data-close-modal>' +
        esc(t('common.close')) + '</button>',
      onOpen: function (dialog) {
        dialog.querySelector('[data-close-modal]').addEventListener('click', UI.closeModal);
        var open = dialog.querySelector('[data-open-invoice]');
        if (open) {
          open.addEventListener('click', function () {
            var id = open.getAttribute('data-open-invoice');
            UI.closeModal();
            window.setTimeout(function () { openInvoice(id); }, 180);
          });
        }
      }
    });
  }

  /* ------------------------------------------------------------ events */
  function bindEvents() {
    var monthSelect = document.getElementById('monthFilter');
    var locationSelect = document.getElementById('locationFilter');
    var reset = document.getElementById('resetFilters');

    if (monthSelect) {
      monthSelect.addEventListener('change', function () {
        state.period = monthSelect.value;
        render();
      });
    }
    if (locationSelect) {
      locationSelect.addEventListener('change', function () {
        state.locationId = locationSelect.value;
        render();
      });
    }
    if (reset) {
      reset.addEventListener('click', function () {
        state.period = Store.getMeta().currentPeriod;
        state.locationId = 'all';
        buildFilters();
        render();
      });
    }

    document.querySelectorAll('[data-quick]').forEach(function (button) {
      button.addEventListener('click', function () {
        var quick = button.getAttribute('data-quick');
        state.period = quick === 'last'
          ? F.addMonths(Store.getMeta().currentPeriod, -1)
          : Store.getMeta().currentPeriod;
        if (monthSelect) monthSelect.value = state.period;
        render();
      });
    });

    var propertyGrid = document.getElementById('propertyGrid');
    if (propertyGrid) {
      propertyGrid.addEventListener('click', function (event) {
        var button = event.target.closest('[data-location-id]');
        if (!button) return;
        var id = button.getAttribute('data-location-id');
        state.locationId = id;
        if (locationSelect) locationSelect.value = id;
        render();
        var location = Store.getLocation(id);
        UI.toast(t('toast.filtered', {
          location: location ? langPick(location.nameKm, location.nameEn) : id
        }), 'success');
        var main = document.getElementById('mainContent');
        if (main) main.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    function invoiceHandler(event) {
      var target = event.target.closest('[data-invoice-id]');
      if (!target) return;
      if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
      if (event.type === 'keydown') event.preventDefault();
      openInvoice(target.getAttribute('data-invoice-id'));
    }

    var tableBody = document.getElementById('invoiceTableBody');
    if (tableBody) {
      tableBody.addEventListener('click', invoiceHandler);
      tableBody.addEventListener('keydown', invoiceHandler);
    }
    var cardList = document.getElementById('invoiceCardList');
    if (cardList) cardList.addEventListener('click', invoiceHandler);

    var reminders = document.getElementById('remindersList');
    if (reminders) {
      reminders.addEventListener('click', function (event) {
        var button = event.target.closest('[data-reminder-id]');
        if (!button) return;
        var invoiceId = button.getAttribute('data-invoice-id');
        var roomId = button.getAttribute('data-room-id');
        if (invoiceId) openInvoice(invoiceId);
        else if (roomId) openRoom(roomId);
      });
    }

    document.addEventListener('rrms:open-invoice', function (event) {
      openInvoice(event.detail.id);
    });
    document.addEventListener('rrms:open-room', function (event) {
      openRoom(event.detail.id);
    });
    document.addEventListener('rrms:open-tenant', function (event) {
      openTenant(event.detail.id);
    });
    document.addEventListener('rrms:filter-location', function (event) {
      var id = event.detail.id;
      if (!Store.getLocation(id)) return;
      state.locationId = id;
      if (locationSelect) locationSelect.value = id;
      render();
      var main = document.getElementById('mainContent');
      if (main) main.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.addEventListener('rrms:language', function () {
      buildFilters();
      render();
    });
  }

  function init() {
    I18n = RRMS.I18n;
    Store = RRMS.Store;
    F = RRMS.Format;
    UI = RRMS.UI;
    Icons = RRMS.Icons;

    I18n.init();
    Icons.hydrate(document);
    state.period = Store.getMeta().currentPeriod;
    state.locationId = 'all';
    buildFilters();
    bindEvents();
    render();
    document.body.classList.add('dashboard-ready');
  }

  RRMS.Dashboard = {
    init: init,
    openInvoice: openInvoice,
    openTenant: openTenant,
    openRoom: openRoom,
    refresh: function () {
      if (!Store) return;
      buildFilters();
      render();
    }
  };

  document.addEventListener('rrms:data-change', function () {
    if (!latest) return;
    var view = document.getElementById('dashboardView');
    if (view && view.hidden) return;
    buildFilters();
    render();
  });

  document.addEventListener('DOMContentLoaded', function () {
    if (document.body.getAttribute('data-page') === 'dashboard') init();
  });
})();
