/* ==========================================================================
   RRMS — Data access & business calculations
   Phase 1 reads a generated demo dataset through this single module. The
   dashboard only consumes the aggregates produced here, so replacing the
   demo dataset with Supabase queries/views later does not touch the UI.
   ========================================================================== */
(function () {
  'use strict';

  window.RRMS = window.RRMS || {};
  var Config = RRMS.Config;
  var F = RRMS.Format;

  var data = null;
  var paymentIndex = null;
  var STORAGE_KEY = (Config.keys && Config.keys.demoData) || 'rrms.demo.v2';

  function pad2(value) { return String(value).padStart(2, '0'); }

  function pad4(value) { return String(value).padStart(4, '0'); }

  function trim(value) {
    return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : (typeof fallback === 'number' ? fallback : 0);
  }

  function clone(value) {
    return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
  }

  function ok(record) { return { ok: true, record: record }; }

  function fail(code, params) { return { ok: false, code: code, params: params || null }; }

  function isDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    return !isNaN(new Date(value + 'T00:00:00').getTime());
  }

  function activeTenancy(tenancy, asOf) {
    if (!tenancy || tenancy.status !== 'active') return false;
    var date = asOf || todayIso();
    if (tenancy.startDate > date) return false;
    if (tenancy.endDate && tenancy.endDate < date) return false;
    return true;
  }

  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    if (aEnd && aEnd < bStart) return false;
    if (bEnd && bEnd < aStart) return false;
    return true;
  }

  function roomHasTenancy(roomId, exceptId) {
    return load().tenancies.some(function (tenancy) {
      return tenancy.roomId === roomId && tenancy.id !== exceptId && tenancy.status === 'active';
    });
  }

  function tenantHasTenancy(tenantId, exceptId) {
    return load().tenancies.some(function (tenancy) {
      return tenancy.tenantId === tenantId && tenancy.id !== exceptId && tenancy.status === 'active';
    });
  }

  function rebuildIndexes() {
    paymentIndex = {};
    load().payments.forEach(function (payment) {
      if (!paymentIndex[payment.invoiceId]) paymentIndex[payment.invoiceId] = [];
      paymentIndex[payment.invoiceId].push(payment);
    });
  }

  function persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        app: 'RRMS',
        version: Config.version,
        seedDate: data.meta.seedDate,
        savedAt: new Date().toISOString(),
        data: {
          locations: data.locations,
          rooms: data.rooms,
          tenants: data.tenants,
          tenancies: data.tenancies,
          meters: data.meters,
          readings: data.readings,
          invoices: data.invoices,
          payments: data.payments,
          settings: data.settings
        }
      }));
      return true;
    } catch (err) {
      if (window.console) console.warn('[Store] Could not persist demo changes.', err);
      return false;
    }
  }

  function clearOverrides() {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ }
  }

  function applyOverrides(target) {
    var raw;
    try { raw = window.localStorage.getItem(STORAGE_KEY); } catch (err) { return; }
    if (!raw) return;
    var payload;
    try { payload = JSON.parse(raw); } catch (err) { clearOverrides(); return; }
    if (!payload || payload.seedDate !== target.meta.seedDate || !payload.data) {
      // The demo dataset is generated relative to today; stale edits are dropped.
      clearOverrides();
      return;
    }
    ['locations', 'rooms', 'tenants', 'tenancies', 'meters', 'readings', 'invoices', 'payments'].forEach(function (key) {
      if (Array.isArray(payload.data[key])) target[key] = payload.data[key];
    });
    if (payload.data.settings && typeof payload.data.settings === 'object') {
      Object.assign(target.settings, payload.data.settings);
    }
  }

  function notifyChange(action, detail) {
    if (typeof document !== 'undefined' && document.dispatchEvent && typeof CustomEvent === 'function') {
      document.dispatchEvent(new CustomEvent('rrms:data-change', {
        detail: Object.assign({ action: action }, detail || {})
      }));
    }
  }

  function nextNumberId(prefix, list, width) {
    var max = 0;
    list.forEach(function (item) {
      var match = String(item.id || '').match(/(\d+)$/);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    });
    return prefix + String(max + 1).padStart(width || 2, '0');
  }

  function nextYearNumber(prefix, list, field, width) {
    var max = 0;
    list.forEach(function (item) {
      var value = String(item[field] || '');
      if (value.indexOf(prefix) === 0) {
        var n = parseInt(value.slice(prefix.length), 10);
        if (isFinite(n)) max = Math.max(max, n);
      }
    });
    return prefix + String(max + 1).padStart(width || 3, '0');
  }

  function invoiceTotal(invoice) {
    return round2(
      num(invoice.rent) +
      num(invoice.electricity && invoice.electricity.amount) +
      num(invoice.water && invoice.water.amount) +
      num(invoice.otherCharges) -
      num(invoice.discount) +
      num(invoice.lateFee) +
      num(invoice.previousBalance)
    );
  }

  function recalcInvoice(invoice) {
    invoice.total = invoiceTotal(invoice);
    invoice.paid = round2((paymentIndex[invoice.id] || []).filter(function (payment) {
      return payment.status === 'completed';
    }).reduce(function (total, payment) { return total + num(payment.amount); }, 0));
    invoice.balance = invoice.status === 'cancelled' ? 0 : round2(Math.max(invoice.total - invoice.paid, 0));
    return invoice;
  }

  function recalcAllInvoices() {
    rebuildIndexes();
    load().invoices.forEach(recalcInvoice);
  }

  function invoiceForRoomPeriod(roomId, period) {
    return load().invoices.find(function (invoice) {
      return invoice.roomId === roomId && invoice.billingPeriod === period && invoice.status !== 'cancelled';
    }) || null;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function iso(date) { return F.isoDate(date); }

  function todayIso() {
    return iso(startOfDay(new Date()));
  }

  function monthStart(period) { return period + '-01'; }

  function monthEnd(period) {
    var p = F.parsePeriod(period);
    return period + '-' + pad2(new Date(p.year, p.month, 0).getDate());
  }

  function round2(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }

  function sum(list, mapper) {
    return list.reduce(function (total, item) { return total + (mapper ? mapper(item) : item); }, 0);
  }

  function load() {
    if (data) return data;
    if (Config.demoMode) {
      data = RRMS.DemoData.build();
    } else {
      // Phase 2+ hydrates from Supabase views; the UI contract stays identical.
      data = RRMS.DemoData.build();
      if (window.console) {
        console.warn('[Store] Supabase adapter not wired yet; using demo records.');
      }
    }
    applyOverrides(data);
    rebuildIndexes();
    return data;
  }

  function getLocations() { return load().locations.slice(); }

  function getLocation(id) {
    return load().locations.find(function (item) { return item.id === id; }) || null;
  }

  function getRooms() { return load().rooms.slice(); }

  function getRoom(id) {
    return load().rooms.find(function (item) { return item.id === id; }) || null;
  }

  function getTenants() { return load().tenants.slice(); }

  function getTenant(id) {
    return load().tenants.find(function (item) { return item.id === id; }) || null;
  }

  function getTenancies() { return load().tenancies.slice(); }

  function getInvoices() { return load().invoices.slice(); }

  function getPayments() { return load().payments.slice(); }

  function getMeters() { return load().meters.slice(); }

  function getReadings() { return load().readings.slice(); }

  function getSettings() { return load().settings; }

  function getMeta() { return load().meta; }

  function getPeriods() {
    return load().meta.months.slice();
  }

  function tenancyCoversPeriod(tenancy, period) {
    if (!tenancy || tenancy.status === 'cancelled') return false;
    var start = monthStart(period);
    var end = monthEnd(period);
    if (tenancy.startDate > end) return false;
    if (tenancy.endDate && tenancy.endDate < start) return false;
    // A tenancy that ended mid-month releases the room immediately, so the
    // occupancy grid does not keep showing a tenant who already moved out.
    if (tenancy.status === 'ended' && tenancy.endDate && tenancy.endDate < end) return false;
    return true;
  }

  function tenancyForRoom(roomId, period) {
    var tenancies = load().tenancies;
    for (var i = 0; i < tenancies.length; i += 1) {
      if (tenancies[i].roomId === roomId && tenancyCoversPeriod(tenancies[i], period)) {
        return tenancies[i];
      }
    }
    return null;
  }

  function paymentsForInvoice(invoiceId) {
    load();
    return (paymentIndex[invoiceId] || []).slice();
  }

  function paidAsOf(invoiceId, asOfDate) {
    return sum(paymentsForInvoice(invoiceId).filter(function (payment) {
      return payment.status === 'completed' && payment.date <= asOfDate;
    }), function (payment) { return payment.amount; });
  }

  function isCollectable(invoice) {
    return invoice.status !== 'cancelled' && invoice.status !== 'draft';
  }

  function balanceAsOf(invoice, asOfDate) {
    if (!isCollectable(invoice)) return 0;
    return round2(Math.max(invoice.total - paidAsOf(invoice.id, asOfDate), 0));
  }

  function displayStatus(invoice) {
    if (invoice.status === 'cancelled') return 'cancelled';
    if (invoice.status === 'draft') return 'draft';
    if (invoice.balance <= 0.005) return 'paid';
    if (invoice.dueDate < todayIso()) return 'overdue';
    if (invoice.paid > 0.005) return 'partial';
    return 'unpaid';
  }

  function invoiceView(invoice) {
    var room = getRoom(invoice.roomId);
    var tenant = getTenant(invoice.tenantId);
    var location = getLocation(invoice.locationId);
    return Object.assign({}, invoice, {
      displayStatus: displayStatus(invoice),
      room: room,
      tenant: tenant,
      location: location,
      roomLabel: room ? room.number : '—',
      tenantName: tenant ? tenant.nameKm : '—',
      tenantNameEn: tenant ? tenant.nameEn : '—',
      locationNameKm: location ? location.nameKm : '—',
      locationNameEn: location ? location.nameEn : '—'
    });
  }

  function getInvoice(id) {
    var invoice = load().invoices.find(function (item) { return item.id === id; });
    return invoice ? invoiceView(invoice) : null;
  }

  function getInvoiceByNumber(number) {
    var invoice = load().invoices.find(function (item) { return item.invoiceNumber === number; });
    return invoice ? invoiceView(invoice) : null;
  }

  function buildInvoiceItems(invoice) {
    var items = [
      { type: 'rent', labelKey: 'item.rent', amount: invoice.rent },
      {
        type: 'electricity',
        labelKey: 'item.electricity',
        amount: invoice.electricity.amount,
        meta: invoice.electricity.previous + ' → ' + invoice.electricity.current + ' kWh × $' + invoice.electricity.rate.toFixed(2)
      },
      {
        type: 'water',
        labelKey: 'item.water',
        amount: invoice.water.amount,
        meta: invoice.water.previous + ' → ' + invoice.water.current + ' m³ × $' + invoice.water.rate.toFixed(2)
      }
    ];
    if (invoice.otherCharges) items.push({ type: 'other', labelKey: 'item.other', amount: invoice.otherCharges });
    if (invoice.lateFee) items.push({ type: 'late_fee', labelKey: 'item.late_fee', amount: invoice.lateFee });
    if (invoice.previousBalance) items.push({ type: 'previous_balance', labelKey: 'item.previous_balance', amount: invoice.previousBalance });
    if (invoice.discount) items.push({ type: 'discount', labelKey: 'item.discount', amount: -invoice.discount });
    return items;
  }

  function getInvoiceDetails(id) {
    var invoice = getInvoice(id);
    if (!invoice) return null;
    var payments = paymentsForInvoice(id).map(function (payment) {
      return Object.assign({}, payment, { methodKey: 'method.' + payment.method });
    }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var tenancy = load().tenancies.find(function (item) { return item.id === invoice.tenancyId; });
    return {
      invoice: invoice,
      items: buildInvoiceItems(invoice),
      payments: payments,
      tenancy: tenancy || null,
      balance: invoice.balance,
      paid: invoice.paid
    };
  }

  function getOpenInvoicesForTenant(tenantId) {
    return load().invoices.filter(function (invoice) {
      return invoice.tenantId === tenantId && isCollectable(invoice) && invoice.balance > 0.005;
    }).map(invoiceView).sort(function (a, b) {
      return a.billingPeriod < b.billingPeriod ? 1 : -1;
    });
  }

  function getTenantDetails(id) {
    var tenant = getTenant(id);
    if (!tenant) return null;
    var tenancy = load().tenancies.find(function (item) {
      return item.tenantId === id && tenancyCoversPeriod(item, getMeta().currentPeriod);
    }) || null;
    var room = tenancy ? getRoom(tenancy.roomId) : null;
    var location = room ? getLocation(room.locationId) : null;
    var invoices = load().invoices.filter(function (invoice) { return invoice.tenantId === id; });
    return {
      tenant: tenant,
      tenancy: tenancy,
      room: room,
      location: location,
      openInvoices: getOpenInvoicesForTenant(id),
      invoiceCount: invoices.length,
      totalBilled: round2(sum(invoices.filter(isCollectable), function (invoice) { return invoice.total; })),
      totalOutstanding: round2(sum(invoices.filter(isCollectable), function (invoice) { return invoice.balance; }))
    };
  }

  function getRoomDetails(id) {
    var room = getRoom(id);
    if (!room) return null;
    var period = getMeta().currentPeriod;
    var tenancy = tenancyForRoom(id, period);
    var tenant = tenancy ? getTenant(tenancy.tenantId) : null;
    var location = getLocation(room.locationId);
    var meters = load().meters.filter(function (meter) { return meter.roomId === id; });
    var latestReadings = {};
    meters.forEach(function (meter) {
      var reading = load().readings.filter(function (item) {
        return item.meterId === meter.id;
      }).sort(function (a, b) { return a.period < b.period ? 1 : -1; })[0];
      latestReadings[meter.utility] = reading || null;
    });
    var invoices = load().invoices.filter(function (invoice) { return invoice.roomId === id; });
    return {
      room: room,
      location: location,
      tenancy: tenancy,
      tenant: tenant,
      meters: meters,
      latestReadings: latestReadings,
      currentInvoice: invoices.filter(function (invoice) { return invoice.billingPeriod === period; }).map(invoiceView)[0] || null,
      historyCount: invoices.length
    };
  }

  function occupancyFor(rooms, period) {
    var occupied = [];
    var vacant = [];
    var other = [];
    rooms.forEach(function (room) {
      var tenancy = tenancyForRoom(room.id, period);
      if (tenancy) {
        occupied.push({ room: room, tenancy: tenancy });
      } else if (room.status === 'reserved' || room.status === 'maintenance' || room.status === 'inactive') {
        other.push(room);
      } else {
        vacant.push(room);
      }
    });
    return { occupied: occupied, vacant: vacant, other: other };
  }

  function invoicesInPeriod(invoices, period) {
    return invoices.filter(function (invoice) {
      return invoice.billingPeriod === period && isCollectable(invoice);
    });
  }

  function paymentsInPeriod(payments, period) {
    var start = monthStart(period);
    var end = monthEnd(period);
    return payments.filter(function (payment) {
      return payment.status === 'completed' && payment.date >= start && payment.date <= end;
    });
  }

  function outstandingAt(invoices, period, asOfDate) {
    return round2(sum(invoices.filter(function (invoice) {
      return isCollectable(invoice) && invoice.billingPeriod <= period;
    }), function (invoice) {
      return balanceAsOf(invoice, asOfDate);
    }));
  }

  function overdueAt(invoices, period, asOfDate) {
    return invoices.filter(function (invoice) {
      return isCollectable(invoice) &&
        invoice.billingPeriod <= period &&
        invoice.dueDate < asOfDate &&
        balanceAsOf(invoice, asOfDate) > 0.005;
    }).map(function (invoice) {
      return Object.assign({}, invoice, { balance: balanceAsOf(invoice, asOfDate), displayStatus: 'overdue' });
    });
  }

  function trend(current, previous) {
    if (!previous) {
      return { percent: current ? 100 : 0, direction: current ? 'up' : 'flat' };
    }
    var delta = ((current - previous) / previous) * 100;
    return {
      percent: Math.abs(delta),
      direction: Math.abs(delta) < 0.05 ? 'flat' : delta > 0 ? 'up' : 'down'
    };
  }

  function dashboardData(options) {
    var opts = options || {};
    var period = opts.period || getMeta().currentPeriod;
    var locationId = opts.locationId || 'all';
    var allLocations = getLocations();
    var allRooms = getRooms();
    var allInvoices = getInvoices();
    var allPayments = getPayments();

    var locations = locationId === 'all'
      ? allLocations
      : allLocations.filter(function (item) { return item.id === locationId; });
    var locationIds = locations.map(function (item) { return item.id; });
    var rooms = allRooms.filter(function (room) { return locationIds.indexOf(room.locationId) !== -1; });
    var invoices = allInvoices.filter(function (invoice) { return locationIds.indexOf(invoice.locationId) !== -1; });
    var payments = allPayments.filter(function (payment) {
      var invoice = allInvoices.find(function (item) { return item.id === payment.invoiceId; });
      return invoice && locationIds.indexOf(invoice.locationId) !== -1;
    });

    var isCurrent = period === getMeta().currentPeriod;
    var asOfDate = isCurrent ? todayIso() : monthEnd(period);
    var occupancy = occupancyFor(rooms, period);
    var monthInvoices = invoicesInPeriod(invoices, period);
    var monthPayments = paymentsInPeriod(payments, period);
    var billed = round2(sum(monthInvoices, function (invoice) { return invoice.total; }));
    var collected = round2(sum(monthPayments, function (payment) { return payment.amount; }));
    var outstanding = outstandingAt(invoices, period, asOfDate);
    var overdueInvoices = overdueAt(invoices, period, todayIso());
    var previousPeriod = F.addMonths(period, -1);
    var prevBilled = round2(sum(invoicesInPeriod(invoices, previousPeriod), function (invoice) { return invoice.total; }));
    var prevCollected = round2(sum(paymentsInPeriod(payments, previousPeriod), function (payment) { return payment.amount; }));

    var propertyCards = locations.map(function (location) {
      var locRooms = allRooms.filter(function (room) { return room.locationId === location.id; });
      var locInvoices = allInvoices.filter(function (invoice) { return invoice.locationId === location.id; });
      var locOccupancy = occupancyFor(locRooms, period);
      var locBilled = round2(sum(invoicesInPeriod(locInvoices, period), function (invoice) { return invoice.total; }));
      var locCollected = round2(sum(paymentsInPeriod(payments.filter(function (payment) {
        return payment.locationId === location.id;
      }), period), function (payment) { return payment.amount; }));
      var locOutstanding = outstandingAt(locInvoices, period, asOfDate);
      var otherCount = locRooms.length - locOccupancy.occupied.length - locOccupancy.vacant.length;
      return {
        location: location,
        totalRooms: locRooms.length,
        occupied: locOccupancy.occupied.length,
        vacant: locOccupancy.vacant.length,
        other: Math.max(otherCount, 0),
        occupancyRate: locRooms.length ? (locOccupancy.occupied.length / locRooms.length) * 100 : 0,
        billed: locBilled,
        collected: locCollected,
        outstanding: locOutstanding
      };
    });

    var chartPeriods = [];
    for (var i = 5; i >= 0; i -= 1) chartPeriods.push(F.addMonths(period, -i));

    var revenueSeries = chartPeriods.map(function (p) {
      return {
        period: p,
        billed: round2(sum(invoicesInPeriod(invoices, p), function (invoice) { return invoice.total; })),
        collected: round2(sum(paymentsInPeriod(payments, p), function (payment) { return payment.amount; }))
      };
    });

    var readings = load().readings.filter(function (reading) {
      return locationIds.indexOf(reading.locationId) !== -1;
    });
    var utilitySeries = chartPeriods.map(function (p) {
      var periodReadings = readings.filter(function (reading) { return reading.period === p; });
      return {
        period: p,
        electricity: round2(sum(periodReadings.filter(function (reading) { return reading.utility === 'electricity'; }), function (reading) { return reading.consumption; })),
        water: round2(sum(periodReadings.filter(function (reading) { return reading.utility === 'water'; }), function (reading) { return reading.consumption; }))
      };
    });

    var outstandingSeries = chartPeriods.map(function (p) {
      var cutoff = p === getMeta().currentPeriod ? todayIso() : monthEnd(p);
      return { period: p, amount: outstandingAt(invoices, p, cutoff) };
    });

    var totalRooms = rooms.length;
    var occupancyBreakdown = {
      occupied: occupancy.occupied.length,
      vacant: occupancy.vacant.length,
      other: occupancy.other.length,
      rate: totalRooms ? (occupancy.occupied.length / totalRooms) * 100 : 0
    };

    var recentInvoices = monthInvoices.slice().sort(function (a, b) {
      if (a.issueDate === b.issueDate) return a.invoiceNumber < b.invoiceNumber ? 1 : -1;
      return a.issueDate < b.issueDate ? 1 : -1;
    }).slice(0, 8).map(invoiceView);

    var monthlySummary = {
      totalLocations: locations.length,
      totalRooms: totalRooms,
      occupiedRooms: occupancy.occupied.length,
      vacantRooms: occupancy.vacant.length,
      monthlyBilled: billed,
      collected: collected,
      outstanding: outstanding,
      overdueCount: overdueInvoices.length,
      occupancyRate: occupancyBreakdown.rate,
      billedTrend: trend(billed, prevBilled),
      collectedTrend: trend(collected, prevCollected)
    };

    return {
      period: period,
      previousPeriod: previousPeriod,
      locationId: locationId,
      asOfDate: asOfDate,
      locations: locations,
      summary: monthlySummary,
      properties: propertyCards,
      revenueSeries: revenueSeries,
      utilitySeries: utilitySeries,
      outstandingSeries: outstandingSeries,
      occupancy: occupancyBreakdown,
      recentInvoices: recentInvoices,
      reminders: buildReminders(period, locationIds),
      chartPeriods: chartPeriods,
      allInvoices: invoices.map(invoiceView)
    };
  }

  function buildReminders(period, locationIds) {
    var reminders = [];
    var rooms = getRooms().filter(function (room) { return locationIds.indexOf(room.locationId) !== -1; });
    var invoices = getInvoices().filter(function (invoice) { return locationIds.indexOf(invoice.locationId) !== -1; });
    var readings = getReadings();
    var tenants = getTenants();
    var invoicesById = {};
    invoices.forEach(function (invoice) { invoicesById[invoice.id] = invoice; });
    var currentPeriod = getMeta().currentPeriod;

    // Missing meter readings for the selected month.
    if (period === currentPeriod) {
      var occupancy = occupancyFor(rooms, period);
      occupancy.occupied.forEach(function (entry) {
        var room = entry.room;
        var elec = readings.find(function (reading) {
          return reading.roomId === room.id && reading.period === period && reading.utility === 'electricity';
        });
        var water = readings.find(function (reading) {
          return reading.roomId === room.id && reading.period === period && reading.utility === 'water';
        });
        if (!elec || !water) {
          reminders.push({
            id: 'missing-' + room.id + '-' + period,
            type: 'missing_reading',
            severity: 'warning',
            icon: 'gauge',
            titleKey: 'reminders.missingReading',
            titleParams: { room: room.number },
            bodyKey: 'reminders.missingReadingBody',
            bodyParams: { month: F.monthLabel(period) },
            roomId: room.id
          });
        }
      });
    }

    // Overdue invoices, one actionable row per invoice (newest first).
    var overdue = invoices.filter(function (invoice) {
      return isCollectable(invoice) && invoice.billingPeriod <= period &&
        invoice.dueDate < todayIso() && invoice.balance > 0.005;
    }).sort(function (a, b) { return a.balance < b.balance ? 1 : -1; }).slice(0, 3);

    overdue.forEach(function (invoice) {
      var tenant = tenants.find(function (item) { return item.id === invoice.tenantId; });
      var room = getRoom(invoice.roomId);
      reminders.push({
        id: 'overdue-' + invoice.id,
        type: 'overdue_invoice',
        severity: 'danger',
        icon: 'receipt',
        titleKey: 'reminders.overdueOne',
        titleParams: { number: invoice.invoiceNumber },
        bodyKey: 'reminders.overdueOneBody',
        bodyParams: {
          tenant: tenant ? tenant.nameKm : '—',
          room: room ? room.number : '—',
          amount: F.money(invoice.balance)
        },
        invoiceId: invoice.id
      });
    });

    // Contracts ending within 45 days.
    getTenancies().filter(function (tenancy) {
      return tenancy.status === 'active' && tenancy.endDate &&
        locationIds.indexOf(tenancy.locationId) !== -1;
    }).forEach(function (tenancy) {
      var limit = new Date();
      limit.setDate(limit.getDate() + 45);
      if (tenancy.endDate <= iso(limit) && tenancy.endDate >= todayIso()) {
        var room = getRoom(tenancy.roomId);
        reminders.push({
          id: 'expiring-' + tenancy.id,
          type: 'expiring_contract',
          severity: 'warning',
          icon: 'calendar',
          titleKey: 'reminders.expiringContract',
          titleParams: {},
          bodyKey: 'reminders.expiringContractBody',
          bodyParams: {
            room: room ? room.number : '—',
            date: F.date(tenancy.endDate)
          },
          roomId: tenancy.roomId
        });
      }
    });

    // Unusually high utility usage in the selected month (vs previous 3 months).
    if (period === currentPeriod) {
      var utilities = ['electricity', 'water'];
      utilities.forEach(function (utility) {
        rooms.forEach(function (room) {
          var current = readings.find(function (reading) {
            return reading.roomId === room.id && reading.period === period && reading.utility === utility;
          });
          if (!current) return;
          var previous = readings.filter(function (reading) {
            return reading.roomId === room.id && reading.utility === utility && reading.period < period;
          }).sort(function (a, b) { return a.period < b.period ? 1 : -1; }).slice(0, 3);
          if (!previous.length) return;
          var average = sum(previous, function (reading) { return reading.consumption; }) / previous.length;
          var threshold = utility === 'electricity' ? 40 : 5;
          if (average > 0 && current.consumption > average * 1.7 && current.consumption - average > threshold) {
            var pct = Math.round(((current.consumption - average) / average) * 100);
            reminders.push({
              id: 'high-' + room.id + '-' + utility + '-' + period,
              type: 'high_usage',
              severity: 'warning',
              icon: utility === 'electricity' ? 'bolt' : 'drop',
              titleKey: 'reminders.highUsage',
              titleParams: { utility: RRMS.I18n.t('charts.' + utility) },
              bodyKey: 'reminders.highUsageBody',
              bodyParams: { room: room.number, percent: pct },
              roomId: room.id
            });
          }
        });
      });
    }

    var order = { danger: 0, warning: 1, info: 2 };
    return reminders.sort(function (a, b) {
      return (order[a.severity] || 9) - (order[b.severity] || 9);
    });
  }

  function getNotifications() {
    var locationIds = getLocations().map(function (location) { return location.id; });
    return buildReminders(getMeta().currentPeriod, locationIds);
  }

  function normalize(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function search(query) {
    var q = normalize(query);
    if (!q) return { attendees: [], tenants: [], rooms: [], invoices: [], locations: [], total: 0 };
    // Allow natural queries such as "បន្ទប់ 201", "room 201" or "tenant Sok".
    var core = q.replace(/^(បន្ទប់|អ្នកជួល|វិក្កយបត្រ|room|tenant|invoice)\s+/i, '').trim();
    if (!core) core = q;
    var digits = q.replace(/\D/g, '');

    var locations = getLocations().filter(function (location) {
      return normalize(location.nameKm).indexOf(q) !== -1 ||
        normalize(location.nameEn).indexOf(q) !== -1 ||
        normalize(location.addressKm).indexOf(q) !== -1 ||
        normalize(location.addressEn).indexOf(q) !== -1;
    }).slice(0, 4);

    var tenants = getTenants().filter(function (tenant) {
      var phoneDigits = String(tenant.phone).replace(/\D/g, '');
      return normalize(tenant.nameKm).indexOf(core) !== -1 ||
        normalize(tenant.nameEn).indexOf(core) !== -1 ||
        (digits.length >= 3 && phoneDigits.indexOf(digits) !== -1);
    }).slice(0, 5);

    var rooms = getRooms().filter(function (room) {
      var location = getLocation(room.locationId);
      return normalize(room.number).indexOf(core) !== -1 ||
        normalize(location ? location.nameKm : '').indexOf(core) !== -1 ||
        normalize(location ? location.nameEn : '').indexOf(core) !== -1;
    }).slice(0, 5);

    var tenantsById = {};
    getTenants().forEach(function (tenant) { tenantsById[tenant.id] = tenant; });
    var roomsById = {};
    getRooms().forEach(function (room) { roomsById[room.id] = room; });

    var invoices = getInvoices().filter(function (invoice) {
      var tenant = tenantsById[invoice.tenantId];
      var room = roomsById[invoice.roomId];
      return normalize(invoice.invoiceNumber).indexOf(q) !== -1 ||
        normalize(invoice.billingPeriod).indexOf(q) !== -1 ||
        (tenant && (normalize(tenant.nameKm).indexOf(core) !== -1 || normalize(tenant.nameEn).indexOf(core) !== -1)) ||
        (room && normalize(room.number).indexOf(core) !== -1);
    }).sort(function (a, b) {
      return a.issueDate < b.issueDate ? 1 : a.issueDate > b.issueDate ? -1 : 0;
    }).slice(0, 5).map(invoiceView);

    return {
      tenants: tenants.map(function (tenant) {
        var details = getTenantDetails(tenant.id);
        return {
          type: 'tenant',
          id: tenant.id,
          titleKm: tenant.nameKm,
          titleEn: tenant.nameEn,
          subtitleKm: F.phone(tenant.phone),
          subtitleEn: F.phone(tenant.phone),
          metaKm: details.room ? (details.location ? details.location.nameKm + ' • បន្ទប់ ' + details.room.number : 'បន្ទប់ ' + details.room.number) : 'គ្មានបន្ទប់',
          metaEn: details.room ? (details.location ? details.location.nameEn + ' • Room ' + details.room.number : 'Room ' + details.room.number) : 'No room'
        };
      }),
      rooms: rooms.map(function (room) {
        var location = getLocation(room.locationId);
        return {
          type: 'room',
          id: room.id,
          titleKm: 'បន្ទប់ ' + room.number,
          titleEn: 'Room ' + room.number,
          subtitleKm: location ? location.nameKm : '',
          subtitleEn: location ? location.nameEn : '',
          metaKm: RRMS.I18n.t('status.' + room.status),
          metaEn: RRMS.I18n.t('status.' + room.status)
        };
      }),
      invoices: invoices.map(function (invoice) {
        return {
          type: 'invoice',
          id: invoice.id,
          titleKm: invoice.invoiceNumber,
          titleEn: invoice.invoiceNumber,
          subtitleKm: (invoice.tenant ? invoice.tenant.nameKm : '—') + ' • ' + F.money(invoice.total),
          subtitleEn: (invoice.tenant ? invoice.tenant.nameEn : '—') + ' • ' + F.money(invoice.total),
          metaKm: F.monthLabel(invoice.billingPeriod) + ' • ' + RRMS.I18n.t('status.' + invoice.displayStatus),
          metaEn: F.monthLabel(invoice.billingPeriod) + ' • ' + RRMS.I18n.t('status.' + invoice.displayStatus)
        };
      }),
      locations: locations.map(function (location) {
        return {
          type: 'location',
          id: location.id,
          titleKm: location.nameKm,
          titleEn: location.nameEn,
          subtitleKm: location.addressKm,
          subtitleEn: location.addressEn,
          metaKm: '',
          metaEn: ''
        };
      }),
      total: tenants.length + rooms.length + invoices.length + locations.length
    };
  }

  /* ------------------------------------------------------ management CRUD */
  function createLocation(input) {
    var source = input || {};
    var nameKm = trim(source.nameKm) || trim(source.nameEn);
    if (!nameKm) return fail('nameRequired');
    var settings = getSettings();
    var record = {
      id: nextNumberId('loc-', load().locations),
      nameKm: nameKm,
      nameEn: trim(source.nameEn) || nameKm,
      addressKm: trim(source.addressKm),
      addressEn: trim(source.addressEn),
      descriptionKm: trim(source.descriptionKm),
      descriptionEn: trim(source.descriptionEn),
      contactName: trim(source.contactName),
      contactPhone: trim(source.contactPhone),
      status: source.status === 'inactive' ? 'inactive' : 'active',
      electricityRate: Math.max(num(source.electricityRate, settings.defaultElectricityRate), 0),
      waterRate: Math.max(num(source.waterRate, settings.defaultWaterRate), 0),
      defaultRent: Math.max(num(source.defaultRent, settings.defaultMonthlyRent), 0),
      currency: 'USD'
    };
    load().locations.push(record);
    persist();
    notifyChange('location:create', { id: record.id });
    return ok(record);
  }

  function updateLocation(id, patch) {
    var location = getLocation(id);
    if (!location) return fail('notFound');
    var source = patch || {};
    if (source.nameKm !== undefined && !trim(source.nameKm)) return fail('nameRequired');
    ['nameKm', 'nameEn', 'addressKm', 'addressEn', 'descriptionKm', 'descriptionEn', 'contactName', 'contactPhone'].forEach(function (field) {
      if (source[field] !== undefined) location[field] = trim(source[field]);
    });
    if (!location.nameEn) location.nameEn = location.nameKm;
    if (source.status !== undefined) location.status = source.status === 'inactive' ? 'inactive' : 'active';
    ['electricityRate', 'waterRate', 'defaultRent'].forEach(function (field) {
      if (source[field] !== undefined) location[field] = Math.max(num(source[field], location[field]), 0);
    });
    persist();
    notifyChange('location:update', { id: id });
    return ok(location);
  }

  function deleteLocation(id) {
    var location = getLocation(id);
    if (!location) return fail('notFound');
    var rooms = load().rooms.filter(function (room) { return room.locationId === id; });
    if (rooms.length) return fail('locationHasRooms', { count: rooms.length });
    var history = load().tenancies.some(function (tenancy) { return tenancy.locationId === id; }) ||
      load().invoices.some(function (invoice) { return invoice.locationId === id; });
    if (history) return fail('locationHasHistory');
    load().locations = load().locations.filter(function (item) { return item.id !== id; });
    persist();
    notifyChange('location:delete', { id: id });
    return ok(true);
  }

  function createMetersForRoom(room) {
    var meters = load().meters;
    var suffix = String(room.locationId).replace(/^loc-/, '');
    var order = meters.length + 1;
    [
      { utility: 'electricity', prefix: 'E' },
      { utility: 'water', prefix: 'W' }
    ].forEach(function (item) {
      meters.push({
        id: 'meter-' + item.prefix.toLowerCase() + '-' + room.id,
        locationId: room.locationId,
        roomId: room.id,
        utility: item.utility,
        meterNumber: item.prefix + '-' + suffix + room.number + '-' + pad2(order),
        allocationMethod: 'individual',
        status: 'active'
      });
      order += 1;
    });
  }

  function createRoom(input) {
    var source = input || {};
    var location = getLocation(source.locationId);
    if (!location) return fail('locationRequired');
    var number = trim(source.number);
    if (!number) return fail('roomNumberRequired');
    var duplicate = load().rooms.some(function (room) {
      return room.locationId === location.id && room.number === number;
    });
    if (duplicate) return fail('roomNumberDuplicate', { number: number });
    var floor = Math.floor(num(source.floor, 1));
    if (floor < 0) return fail('floorInvalid');
    var rent = num(source.monthlyRent, location.defaultRent);
    if (rent < 0) return fail('rentInvalid');
    var types = ['standard', 'large', 'small', 'studio', 'shop'];
    var type = types.indexOf(source.type) !== -1 ? source.type : 'standard';
    var statuses = ['vacant', 'reserved', 'maintenance', 'inactive'];
    var status = statuses.indexOf(source.status) !== -1 ? source.status : 'vacant';
    var baseId = 'room-' + String(location.id).replace(/^loc-/, '') + '-' + number.replace(/[^A-Za-z0-9]/g, '');
    var id = baseId;
    var counter = 2;
    while (load().rooms.some(function (room) { return room.id === id; })) {
      id = baseId + '-' + counter;
      counter += 1;
    }
    var room = {
      id: id,
      locationId: location.id,
      number: number,
      floor: floor,
      type: type,
      monthlyRent: rent,
      status: status,
      notes: trim(source.notes)
    };
    load().rooms.push(room);
    createMetersForRoom(room);
    persist();
    notifyChange('room:create', { id: room.id });
    return ok(room);
  }

  function updateRoom(id, patch) {
    var room = getRoom(id);
    if (!room) return fail('notFound');
    var source = patch || {};
    if (source.number !== undefined) {
      var number = trim(source.number);
      if (!number) return fail('roomNumberRequired');
      var duplicate = load().rooms.some(function (item) {
        return item.id !== id && item.locationId === room.locationId && item.number === number;
      });
      if (duplicate) return fail('roomNumberDuplicate', { number: number });
      room.number = number;
    }
    if (source.locationId !== undefined && source.locationId !== room.locationId) {
      var location = getLocation(source.locationId);
      if (!location) return fail('locationRequired');
      var history = load().tenancies.some(function (tenancy) { return tenancy.roomId === id; }) ||
        load().invoices.some(function (invoice) { return invoice.roomId === id; });
      if (history) return fail('roomHasHistory');
      room.locationId = location.id;
      load().meters.forEach(function (meter) {
        if (meter.roomId === id) meter.locationId = location.id;
      });
    }
    if (source.floor !== undefined) {
      var floor = Math.floor(num(source.floor, room.floor));
      if (floor < 0) return fail('floorInvalid');
      room.floor = floor;
    }
    if (source.type !== undefined && ['standard', 'large', 'small', 'studio', 'shop'].indexOf(source.type) !== -1) {
      room.type = source.type;
    }
    if (source.monthlyRent !== undefined) {
      var rent = num(source.monthlyRent, room.monthlyRent);
      if (rent < 0) return fail('rentInvalid');
      room.monthlyRent = rent;
    }
    if (source.status !== undefined && ['vacant', 'reserved', 'maintenance', 'inactive'].indexOf(source.status) !== -1) {
      room.status = source.status;
    }
    if (roomHasTenancy(id)) room.status = 'occupied';
    if (source.notes !== undefined) room.notes = trim(source.notes);
    persist();
    notifyChange('room:update', { id: id });
    return ok(room);
  }

  function deleteRoom(id) {
    var room = getRoom(id);
    if (!room) return fail('notFound');
    var history = load().tenancies.some(function (tenancy) { return tenancy.roomId === id; }) ||
      load().invoices.some(function (invoice) { return invoice.roomId === id; }) ||
      load().readings.some(function (reading) { return reading.roomId === id; });
    if (history) return fail('roomHasHistory');
    load().rooms = load().rooms.filter(function (item) { return item.id !== id; });
    load().meters = load().meters.filter(function (meter) { return meter.roomId !== id; });
    persist();
    notifyChange('room:delete', { id: id });
    return ok(true);
  }

  function createTenant(input) {
    var source = input || {};
    var nameKm = trim(source.nameKm) || trim(source.nameEn);
    if (!nameKm) return fail('nameRequired');
    var phone = trim(source.phone);
    if (String(phone).replace(/\D/g, '').length < 8) return fail('phoneRequired');
    var tenant = {
      id: nextNumberId('tenant-', load().tenants),
      nameKm: nameKm,
      nameEn: trim(source.nameEn) || nameKm,
      phone: phone,
      email: trim(source.email),
      idNumber: trim(source.idNumber),
      addressKm: trim(source.addressKm),
      addressEn: trim(source.addressEn),
      emergencyContactName: trim(source.emergencyContactName),
      emergencyContactPhone: trim(source.emergencyContactPhone),
      notes: trim(source.notes),
      status: 'active'
    };
    load().tenants.push(tenant);
    persist();
    notifyChange('tenant:create', { id: tenant.id });
    return ok(tenant);
  }

  function updateTenant(id, patch) {
    var tenant = getTenant(id);
    if (!tenant) return fail('notFound');
    var source = patch || {};
    if (source.nameKm !== undefined && !trim(source.nameKm)) return fail('nameRequired');
    ['nameKm', 'nameEn', 'phone', 'email', 'idNumber', 'addressKm', 'addressEn',
      'emergencyContactName', 'emergencyContactPhone', 'notes'].forEach(function (field) {
      if (source[field] !== undefined) tenant[field] = trim(source[field]);
    });
    if (!tenant.nameEn) tenant.nameEn = tenant.nameKm;
    if (source.status !== undefined) tenant.status = source.status === 'inactive' ? 'inactive' : 'active';
    persist();
    notifyChange('tenant:update', { id: id });
    return ok(tenant);
  }

  function deleteTenant(id) {
    var tenant = getTenant(id);
    if (!tenant) return fail('notFound');
    var history = load().tenancies.some(function (tenancy) { return tenancy.tenantId === id; }) ||
      load().invoices.some(function (invoice) { return invoice.tenantId === id; });
    if (history) return fail('tenantHasHistory');
    load().tenants = load().tenants.filter(function (item) { return item.id !== id; });
    persist();
    notifyChange('tenant:delete', { id: id });
    return ok(true);
  }

  function assignTenant(input) {
    var source = input || {};
    var tenant = getTenant(source.tenantId);
    if (!tenant) return fail('tenantRequired');
    var room = getRoom(source.roomId);
    if (!room) return fail('roomRequired');
    var startDate = source.startDate || todayIso();
    if (!isDate(startDate)) return fail('dateRequired');
    var endDate = source.endDate ? source.endDate : null;
    if (endDate && !isDate(endDate)) return fail('dateRequired');
    if (endDate && endDate < startDate) return fail('dateOrder');

    var overlapping = load().tenancies.some(function (tenancy) {
      return tenancy.roomId === room.id && tenancy.status === 'active' &&
        rangesOverlap(tenancy.startDate, tenancy.endDate, startDate, endDate);
    });
    if (overlapping) return fail('roomOccupied');

    var tenantBusy = load().tenancies.some(function (tenancy) {
      return tenancy.tenantId === tenant.id && tenancy.status === 'active' &&
        rangesOverlap(tenancy.startDate, tenancy.endDate, startDate, endDate);
    });
    if (tenantBusy) return fail('tenantOccupied');

    var rent = num(source.monthlyRent, room.monthlyRent);
    if (rent < 0) return fail('rentInvalid');
    var deposit = num(source.depositAmount, rent);
    var tenancy = {
      id: nextNumberId('tenancy-', load().tenancies),
      tenantId: tenant.id,
      roomId: room.id,
      locationId: room.locationId,
      startDate: startDate,
      endDate: endDate,
      moveOutDate: null,
      monthlyRent: rent,
      depositAmount: deposit,
      depositPaid: num(source.depositPaid, deposit),
      status: 'active',
      notes: trim(source.notes)
    };
    load().tenancies.push(tenancy);
    room.status = 'occupied';
    tenant.status = 'active';
    persist();
    notifyChange('tenancy:assign', { id: tenancy.id, roomId: room.id, tenantId: tenant.id });
    return ok(tenancy);
  }

  function updateTenancy(id, patch) {
    var tenancy = load().tenancies.find(function (item) { return item.id === id; });
    if (!tenancy) return fail('notFound');
    var source = patch || {};
    if (source.endDate !== undefined) {
      if (source.endDate && !isDate(source.endDate)) return fail('dateRequired');
      if (source.endDate && source.endDate < tenancy.startDate) return fail('dateOrder');
      tenancy.endDate = source.endDate || null;
    }
    if (source.monthlyRent !== undefined) {
      var rent = num(source.monthlyRent, tenancy.monthlyRent);
      if (rent < 0) return fail('rentInvalid');
      tenancy.monthlyRent = rent;
    }
    if (source.depositAmount !== undefined) tenancy.depositAmount = Math.max(num(source.depositAmount, 0), 0);
    if (source.depositPaid !== undefined) tenancy.depositPaid = Math.max(num(source.depositPaid, 0), 0);
    if (source.notes !== undefined) tenancy.notes = trim(source.notes);
    if (source.status === 'active' || source.status === 'ended' || source.status === 'cancelled') {
      tenancy.status = source.status;
    }
    persist();
    notifyChange('tenancy:update', { id: id, roomId: tenancy.roomId });
    return ok(tenancy);
  }

  function endTenancy(id, input) {
    var tenancy = load().tenancies.find(function (item) { return item.id === id; });
    if (!tenancy) return fail('notFound');
    if (tenancy.status !== 'active') return fail('tenancyNotActive');
    var source = input || {};
    var endDate = source.endDate || todayIso();
    if (!isDate(endDate)) return fail('dateRequired');
    if (endDate < tenancy.startDate) return fail('dateOrder');
    tenancy.endDate = endDate;
    tenancy.moveOutDate = source.moveOutDate || endDate;
    tenancy.status = 'ended';
    if (source.notes !== undefined) tenancy.notes = trim(source.notes);
    var room = getRoom(tenancy.roomId);
    if (room) {
      var other = load().tenancies.some(function (item) {
        return item.id !== id && item.roomId === room.id && item.status === 'active';
      });
      room.status = other ? 'occupied' : 'vacant';
    }
    persist();
    notifyChange('tenancy:end', { id: id, roomId: tenancy.roomId });
    return ok(tenancy);
  }

  function deleteTenancy(id) {
    var tenancy = load().tenancies.find(function (item) { return item.id === id; });
    if (!tenancy) return fail('notFound');
    var hasInvoices = load().invoices.some(function (invoice) { return invoice.tenancyId === id; });
    if (hasInvoices) return fail('tenancyHasInvoices');
    load().tenancies = load().tenancies.filter(function (item) { return item.id !== id; });
    var room = getRoom(tenancy.roomId);
    if (room) {
      var other = load().tenancies.some(function (item) {
        return item.roomId === room.id && item.status === 'active';
      });
      room.status = other ? 'occupied' : 'vacant';
    }
    persist();
    notifyChange('tenancy:delete', { id: id, roomId: tenancy.roomId });
    return ok(true);
  }

  function saveReading(input) {
    var source = input || {};
    var room = getRoom(source.roomId);
    if (!room) return fail('roomRequired');
    var utility = source.utility === 'water' ? 'water' : 'electricity';
    var period = source.period || getMeta().currentPeriod;
    if (!/^\d{4}-\d{2}$/.test(String(period))) return fail('invalidPeriod');
    var location = getLocation(room.locationId);
    var existing = load().readings.find(function (reading) {
      return reading.roomId === room.id && reading.utility === utility && reading.period === period;
    });
    var current = Number(source.current);
    if (!isFinite(current)) return fail('readingCurrentRequired');
    var prior = load().readings.filter(function (reading) {
      return reading.roomId === room.id && reading.utility === utility && reading.period < period;
    }).sort(function (a, b) { return a.period < b.period ? 1 : -1; })[0];
    var previous = prior ? num(prior.current) : (existing ? num(existing.previous) : 0);
    var consumption = round2(current - previous);
    if (consumption < 0) return fail('readingNegative');
    var rate = num(source.rate, utility === 'electricity' ? location.electricityRate : location.waterRate);
    var tenancy = tenancyForRoom(room.id, period);
    var meter = load().meters.find(function (item) {
      return item.roomId === room.id && item.utility === utility;
    });
    var reading = existing || {
      id: nextNumberId('reading-', load().readings, 4),
      meterId: meter ? meter.id : null,
      locationId: room.locationId,
      roomId: room.id,
      utility: utility,
      period: period
    };
    reading.tenancyId = tenancy ? tenancy.id : null;
    reading.readingDate = source.readingDate || todayIso();
    reading.previous = previous;
    reading.current = current;
    reading.consumption = consumption;
    reading.rate = rate;
    reading.amount = round2(consumption * rate);
    if (!existing) load().readings.push(reading);

    var invoice = invoiceForRoomPeriod(room.id, period);
    if (invoice) {
      invoice[utility] = {
        previous: reading.previous,
        current: reading.current,
        consumption: reading.consumption,
        rate: reading.rate,
        amount: reading.amount
      };
      recalcInvoice(invoice);
    }
    persist();
    notifyChange('reading:save', { id: reading.id, roomId: room.id, period: period });
    return ok(reading);
  }

  function deleteReading(id) {
    var reading = load().readings.find(function (item) { return item.id === id; });
    if (!reading) return fail('notFound');
    if (invoiceForRoomPeriod(reading.roomId, reading.period)) return fail('readingHasInvoice');
    load().readings = load().readings.filter(function (item) { return item.id !== id; });
    persist();
    notifyChange('reading:delete', { id: id, roomId: reading.roomId, period: reading.period });
    return ok(true);
  }

  function generateInvoices(input) {
    var source = input || {};
    var period = source.period || getMeta().currentPeriod;
    if (!/^\d{4}-\d{2}$/.test(String(period))) return fail('invalidPeriod');
    var locationId = source.locationId || 'all';
    var created = 0;
    var skipped = 0;
    var missing = [];
    var issueDate = source.issueDate || (period + '-03');
    if (period === getMeta().currentPeriod && todayIso() < issueDate) issueDate = todayIso();
    var dueDate = source.dueDate || (F.addMonths(period, 1) + '-05');

    load().tenancies.filter(function (tenancy) {
      return tenancy.status === 'active' && tenancyCoversPeriod(tenancy, period) &&
        (locationId === 'all' || tenancy.locationId === locationId);
    }).forEach(function (tenancy) {
      var room = getRoom(tenancy.roomId);
      if (!room) return;
      var exists = load().invoices.some(function (invoice) {
        return invoice.tenancyId === tenancy.id && invoice.billingPeriod === period;
      });
      if (exists) { skipped += 1; return; }
      var electricity = load().readings.find(function (reading) {
        return reading.roomId === room.id && reading.utility === 'electricity' && reading.period === period;
      });
      var water = load().readings.find(function (reading) {
        return reading.roomId === room.id && reading.utility === 'water' && reading.period === period;
      });
      if (!electricity) missing.push({ room: room.number, utility: 'electricity' });
      if (!water) missing.push({ room: room.number, utility: 'water' });
      var rent = num(tenancy.monthlyRent, room.monthlyRent);
      var invoice = {
        id: nextNumberId('invoice-', load().invoices),
        invoiceNumber: nextYearNumber('INV-' + F.parsePeriod(period).year + '-', load().invoices, 'invoiceNumber'),
        billingPeriod: period,
        locationId: room.locationId,
        roomId: room.id,
        tenancyId: tenancy.id,
        tenantId: tenancy.tenantId,
        issueDate: issueDate,
        dueDate: dueDate,
        rent: rent,
        electricity: electricity ? {
          previous: electricity.previous,
          current: electricity.current,
          consumption: electricity.consumption,
          rate: electricity.rate,
          amount: electricity.amount
        } : { previous: 0, current: 0, consumption: 0, rate: 0, amount: 0 },
        water: water ? {
          previous: water.previous,
          current: water.current,
          consumption: water.consumption,
          rate: water.rate,
          amount: water.amount
        } : { previous: 0, current: 0, consumption: 0, rate: 0, amount: 0 },
        otherCharges: Math.max(num(source.otherCharges, 0), 0),
        discount: Math.max(num(source.discount, 0), 0),
        lateFee: 0,
        previousBalance: 0,
        total: 0,
        paid: 0,
        balance: 0,
        status: 'finalized',
        currency: 'USD',
        notes: trim(source.notes)
      };
      invoice.total = invoiceTotal(invoice);
      invoice.balance = invoice.total;
      load().invoices.push(invoice);
      created += 1;
    });

    if (created) {
      recalcAllInvoices();
      persist();
      notifyChange('invoice:generate', { period: period, created: created });
    }
    return { ok: true, result: { created: created, skipped: skipped, missing: missing } };
  }

  function updateInvoice(id, patch) {
    var invoice = load().invoices.find(function (item) { return item.id === id; });
    if (!invoice) return fail('notFound');
    if (invoice.status === 'cancelled') return fail('invoiceCancelled');
    var source = patch || {};
    ['otherCharges', 'discount', 'lateFee', 'previousBalance'].forEach(function (field) {
      if (source[field] !== undefined) invoice[field] = Math.max(num(source[field], invoice[field]), 0);
    });
    if (source.dueDate !== undefined) {
      if (!isDate(source.dueDate)) return fail('dateRequired');
      invoice.dueDate = source.dueDate;
    }
    if (source.issueDate !== undefined && isDate(source.issueDate)) invoice.issueDate = source.issueDate;
    if (source.notes !== undefined) invoice.notes = trim(source.notes);
    recalcInvoice(invoice);
    persist();
    notifyChange('invoice:update', { id: id });
    return ok(invoice);
  }

  function cancelInvoice(id) {
    var invoice = load().invoices.find(function (item) { return item.id === id; });
    if (!invoice) return fail('notFound');
    if (invoice.status === 'cancelled') return fail('invoiceCancelled');
    if (num(invoice.paid) > 0.005) return fail('invoicePaid');
    invoice.status = 'cancelled';
    invoice.balance = 0;
    persist();
    notifyChange('invoice:cancel', { id: id });
    return ok(invoice);
  }

  function deleteInvoice(id) {
    var invoice = load().invoices.find(function (item) { return item.id === id; });
    if (!invoice) return fail('notFound');
    if (paymentsForInvoice(id).length) return fail('invoiceHasPayments');
    load().invoices = load().invoices.filter(function (item) { return item.id !== id; });
    persist();
    notifyChange('invoice:delete', { id: id });
    return ok(true);
  }

  function recordPayment(input) {
    var source = input || {};
    var invoice = load().invoices.find(function (item) { return item.id === source.invoiceId; });
    if (!invoice) return fail('invoiceNotFound');
    if (invoice.status === 'cancelled') return fail('invoiceCancelled');
    var amount = round2(num(source.amount, 0));
    if (!(amount > 0)) return fail('paymentAmount');
    if (amount > round2(invoice.balance + 0.005)) return fail('paymentTooLarge', { balance: invoice.balance });
    var date = source.date || todayIso();
    if (!isDate(date)) return fail('dateRequired');
    var method = ['cash', 'aba', 'acleda', 'bank_transfer', 'other'].indexOf(source.method) !== -1 ? source.method : 'cash';
    var payment = {
      id: nextNumberId('payment-', load().payments),
      paymentNumber: nextYearNumber('PAY-' + F.parsePeriod(date).year + '-', load().payments, 'paymentNumber', 4),
      invoiceId: invoice.id,
      tenantId: invoice.tenantId,
      locationId: invoice.locationId,
      period: invoice.billingPeriod,
      date: date,
      amount: amount,
      currency: 'USD',
      method: method,
      reference: trim(source.reference),
      notes: trim(source.notes),
      status: 'completed'
    };
    load().payments.push(payment);
    rebuildIndexes();
    recalcInvoice(invoice);
    persist();
    notifyChange('payment:create', { id: payment.id, invoiceId: invoice.id });
    return ok(payment);
  }

  function deletePayment(id) {
    var payment = load().payments.find(function (item) { return item.id === id; });
    if (!payment) return fail('notFound');
    load().payments = load().payments.filter(function (item) { return item.id !== id; });
    rebuildIndexes();
    var invoice = load().invoices.find(function (item) { return item.id === payment.invoiceId; });
    if (invoice) recalcInvoice(invoice);
    persist();
    notifyChange('payment:delete', { id: id, invoiceId: payment.invoiceId });
    return ok(true);
  }

  function updateSettings(patch) {
    var source = patch || {};
    var settings = load().settings;
    ['companyNameKm', 'companyNameEn', 'currency', 'secondaryCurrency', 'dateFormat'].forEach(function (field) {
      if (source[field] !== undefined) settings[field] = trim(source[field]);
    });
    ['exchangeRateKhr', 'defaultElectricityRate', 'defaultWaterRate', 'defaultMonthlyRent', 'invoiceDueDay'].forEach(function (field) {
      if (source[field] !== undefined) settings[field] = Math.max(num(source[field], settings[field]), 0);
    });
    if (source.defaultLanguage === 'km' || source.defaultLanguage === 'en') settings.defaultLanguage = source.defaultLanguage;
    persist();
    notifyChange('settings:update', {});
    return ok(settings);
  }

  function resetDemoData() {
    clearOverrides();
    data = null;
    paymentIndex = null;
    notifyChange('demo:reset', {});
    return ok(true);
  }

  function exportData() {
    var current = load();
    return JSON.stringify({
      app: 'RRMS',
      version: Config.version,
      seedDate: current.meta.seedDate,
      exportedAt: new Date().toISOString(),
      data: {
        locations: current.locations,
        rooms: current.rooms,
        tenants: current.tenants,
        tenancies: current.tenancies,
        meters: current.meters,
        readings: current.readings,
        invoices: current.invoices,
        payments: current.payments,
        settings: current.settings
      }
    }, null, 2);
  }

  function importData(raw) {
    var payload;
    try { payload = JSON.parse(raw); } catch (err) { return fail('importInvalid'); }
    var bundle = payload && payload.data ? payload.data : payload;
    if (!bundle || !Array.isArray(bundle.locations) || !Array.isArray(bundle.rooms) ||
      !Array.isArray(bundle.tenants) || !Array.isArray(bundle.tenancies)) {
      return fail('importInvalid');
    }
    var target = load();
    ['locations', 'rooms', 'tenants', 'tenancies'].forEach(function (key) {
      target[key] = clone(bundle[key]);
    });
    ['meters', 'readings', 'invoices', 'payments'].forEach(function (key) {
      if (Array.isArray(bundle[key])) target[key] = clone(bundle[key]);
      else target[key] = [];
    });
    if (bundle.settings && typeof bundle.settings === 'object') {
      Object.assign(target.settings, bundle.settings);
    }
    recalcAllInvoices();
    persist();
    notifyChange('data:import', {});
    return ok(true);
  }

  function hasLocalChanges() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var payload = JSON.parse(raw);
      return payload.seedDate === getMeta().seedDate;
    } catch (err) {
      return false;
    }
  }

  function effectiveRoomStatus(room, tenancy) {
    return tenancy ? 'occupied' : room.status;
  }

  function getLocationList() {
    var period = getMeta().currentPeriod;
    return getLocations().map(function (location) {
      var rooms = load().rooms.filter(function (room) { return room.locationId === location.id; });
      var occupancy = occupancyFor(rooms, period);
      var invoices = load().invoices.filter(function (invoice) { return invoice.locationId === location.id; });
      return {
        location: location,
        totalRooms: rooms.length,
        occupied: occupancy.occupied.length,
        vacant: occupancy.vacant.length,
        other: occupancy.other.length,
        occupancyRate: rooms.length ? (occupancy.occupied.length / rooms.length) * 100 : 0,
        outstanding: round2(sum(invoices.filter(isCollectable), function (invoice) { return invoice.balance; })),
        billed: round2(sum(invoices.filter(function (invoice) {
          return invoice.billingPeriod === period && isCollectable(invoice);
        }), function (invoice) { return invoice.total; }))
      };
    });
  }

  function getRoomList(filters) {
    var opts = filters || {};
    var period = opts.period || getMeta().currentPeriod;
    var locationId = opts.locationId || 'all';
    var status = opts.status || 'all';
    var query = normalize(opts.query);
    return load().rooms.filter(function (room) {
      if (locationId !== 'all' && room.locationId !== locationId) return false;
      var tenancy = tenancyForRoom(room.id, period);
      var effective = effectiveRoomStatus(room, tenancy);
      if (status !== 'all' && effective !== status) return false;
      if (query) {
        var location = getLocation(room.locationId);
        var text = normalize(room.number + ' ' + room.type + ' ' + (location ? location.nameKm + ' ' + location.nameEn : ''));
        if (text.indexOf(query) === -1) return false;
      }
      return true;
    }).map(function (room) {
      var tenancy = tenancyForRoom(room.id, period);
      var tenant = tenancy ? getTenant(tenancy.tenantId) : null;
      var location = getLocation(room.locationId);
      var invoices = load().invoices.filter(function (invoice) { return invoice.roomId === room.id; });
      var current = invoiceForRoomPeriod(room.id, period);
      return {
        room: room,
        location: location,
        tenancy: tenancy,
        tenant: tenant,
        status: effectiveRoomStatus(room, tenancy),
        currentInvoice: current ? invoiceView(current) : null,
        balance: round2(sum(invoices.filter(isCollectable), function (invoice) { return invoice.balance; })),
        historyCount: invoices.length
      };
    }).sort(function (a, b) {
      var locA = a.location ? a.location.nameKm : '';
      var locB = b.location ? b.location.nameKm : '';
      if (locA !== locB) return locA < locB ? -1 : 1;
      return a.room.number.localeCompare(b.room.number, undefined, { numeric: true });
    });
  }

  function getTenantList(filters) {
    var opts = filters || {};
    var query = normalize(opts.query);
    var period = opts.period || getMeta().currentPeriod;
    return load().tenants.filter(function (tenant) {
      if (tenant.status === 'inactive') return false;
      if (!query) return true;
      var text = normalize(tenant.nameKm + ' ' + tenant.nameEn + ' ' + tenant.phone + ' ' + tenant.email);
      return text.indexOf(query) !== -1;
    }).map(function (tenant) {
      var tenancy = load().tenancies.find(function (item) {
        return item.tenantId === tenant.id && item.status === 'active' && tenancyCoversPeriod(item, period);
      }) || null;
      var room = tenancy ? getRoom(tenancy.roomId) : null;
      var location = room ? getLocation(room.locationId) : null;
      var invoices = load().invoices.filter(function (invoice) { return invoice.tenantId === tenant.id; });
      return {
        tenant: tenant,
        tenancy: tenancy,
        room: room,
        location: location,
        outstanding: round2(sum(invoices.filter(isCollectable), function (invoice) { return invoice.balance; })),
        invoiceCount: invoices.filter(isCollectable).length
      };
    }).sort(function (a, b) {
      return a.tenant.nameKm.localeCompare(b.tenant.nameKm);
    });
  }

  function getTenancyList(filters) {
    var opts = filters || {};
    var status = opts.status || 'all';
    return load().tenancies.filter(function (tenancy) {
      return status === 'all' || tenancy.status === status;
    }).map(function (tenancy) {
      var tenant = getTenant(tenancy.tenantId);
      var room = getRoom(tenancy.roomId);
      var location = getLocation(tenancy.locationId);
      return { tenancy: tenancy, tenant: tenant, room: room, location: location };
    }).sort(function (a, b) {
      return a.tenancy.startDate < b.tenancy.startDate ? 1 : -1;
    });
  }

  function getMeterList(period, locationId) {
    var targetPeriod = period || getMeta().currentPeriod;
    var selected = locationId || 'all';
    var rows = load().rooms.filter(function (room) {
      return selected === 'all' || room.locationId === selected;
    }).map(function (room) {
      var location = getLocation(room.locationId);
      var tenancy = tenancyForRoom(room.id, targetPeriod);
      var tenant = tenancy ? getTenant(tenancy.tenantId) : null;
      var readings = {};
      ['electricity', 'water'].forEach(function (utility) {
        var reading = load().readings.find(function (item) {
          return item.roomId === room.id && item.utility === utility && item.period === targetPeriod;
        });
        var prior = load().readings.filter(function (item) {
          return item.roomId === room.id && item.utility === utility && item.period < targetPeriod;
        }).sort(function (a, b) { return a.period < b.period ? 1 : -1; })[0];
        readings[utility] = reading || null;
        readings[utility + 'Previous'] = prior ? prior.current : 0;
      });
      return {
        room: room,
        location: location,
        tenancy: tenancy,
        tenant: tenant,
        electricity: readings.electricity,
        water: readings.water,
        electricityPrevious: readings.electricityPrevious,
        waterPrevious: readings.waterPrevious,
        missing: tenancy ? ['electricity', 'water'].filter(function (utility) { return !readings[utility]; }) : []
      };
    }).sort(function (a, b) {
      var locA = a.location ? a.location.nameKm : '';
      var locB = b.location ? b.location.nameKm : '';
      if (locA !== locB) return locA < locB ? -1 : 1;
      return a.room.number.localeCompare(b.room.number, undefined, { numeric: true });
    });
    return {
      period: targetPeriod,
      rows: rows,
      missingCount: rows.reduce(function (total, row) { return total + row.missing.length; }, 0),
      occupiedCount: rows.filter(function (row) { return !!row.tenancy; }).length
    };
  }

  function getInvoiceList(filters) {
    var opts = filters || {};
    var period = opts.period || 'all';
    var locationId = opts.locationId || 'all';
    var status = opts.status || 'all';
    var query = normalize(opts.query);
    var tenantId = opts.tenantId || null;
    var roomId = opts.roomId || null;
    return load().invoices.filter(function (invoice) {
      if (period !== 'all' && invoice.billingPeriod !== period) return false;
      if (locationId !== 'all' && invoice.locationId !== locationId) return false;
      if (tenantId && invoice.tenantId !== tenantId) return false;
      if (roomId && invoice.roomId !== roomId) return false;
      var view = invoiceView(invoice);
      if (status !== 'all' && view.displayStatus !== status) return false;
      if (query) {
        var tenant = view.tenant;
        var text = normalize(invoice.invoiceNumber + ' ' + invoice.billingPeriod + ' ' +
          (tenant ? tenant.nameKm + ' ' + tenant.nameEn : '') + ' ' + view.roomLabel);
        if (text.indexOf(query) === -1) return false;
      }
      return true;
    }).map(invoiceView).sort(function (a, b) {
      if (a.billingPeriod !== b.billingPeriod) return a.billingPeriod < b.billingPeriod ? 1 : -1;
      return a.invoiceNumber < b.invoiceNumber ? 1 : -1;
    });
  }

  function getPaymentList(filters) {
    var opts = filters || {};
    var period = opts.period || 'all';
    var locationId = opts.locationId || 'all';
    var method = opts.method || 'all';
    var query = normalize(opts.query);
    return load().payments.filter(function (payment) {
      if (period !== 'all' && !paymentInPeriod(payment, period)) return false;
      if (locationId !== 'all' && payment.locationId !== locationId) return false;
      if (method !== 'all' && payment.method !== method) return false;
      if (query) {
        var invoice = load().invoices.find(function (item) { return item.id === payment.invoiceId; });
        var tenant = getTenant(payment.tenantId);
        var text = normalize(payment.paymentNumber + ' ' + (invoice ? invoice.invoiceNumber : '') + ' ' +
          (tenant ? tenant.nameKm + ' ' + tenant.nameEn : '') + ' ' + payment.reference);
        if (text.indexOf(query) === -1) return false;
      }
      return true;
    }).map(function (payment) {
      var invoice = load().invoices.find(function (item) { return item.id === payment.invoiceId; });
      var tenant = getTenant(payment.tenantId);
      var room = invoice ? getRoom(invoice.roomId) : null;
      var location = getLocation(payment.locationId);
      return {
        payment: payment,
        invoice: invoice ? invoiceView(invoice) : null,
        tenant: tenant,
        room: room,
        location: location
      };
    }).sort(function (a, b) {
      if (a.payment.date !== b.payment.date) return a.payment.date < b.payment.date ? 1 : -1;
      return a.payment.paymentNumber < b.payment.paymentNumber ? 1 : -1;
    });
  }

  function getReportData(period, locationId) {
    var targetPeriod = period || getMeta().currentPeriod;
    var selected = locationId || 'all';
    var dashboard = dashboardData({ period: targetPeriod, locationId: selected });
    var locationIds = dashboard.locations.map(function (item) { return item.id; });
    var invoices = load().invoices.filter(function (invoice) {
      return locationIds.indexOf(invoice.locationId) !== -1 && isCollectable(invoice) &&
        invoice.billingPeriod <= targetPeriod;
    });
    var monthInvoices = invoices.filter(function (invoice) { return invoice.billingPeriod === targetPeriod; });
    var payments = load().payments.filter(function (payment) {
      return locationIds.indexOf(payment.locationId) !== -1 && payment.status === 'completed' &&
        paymentInPeriod(payment, targetPeriod);
    });
    var methodTotals = {};
    payments.forEach(function (payment) {
      methodTotals[payment.method] = round2((methodTotals[payment.method] || 0) + payment.amount);
    });
    var statusCounts = { paid: 0, partial: 0, unpaid: 0, overdue: 0 };
    monthInvoices.forEach(function (invoice) {
      var view = invoiceView(invoice);
      if (statusCounts[view.displayStatus] !== undefined) statusCounts[view.displayStatus] += 1;
    });
    var byTenant = {};
    invoices.forEach(function (invoice) {
      if (invoice.balance <= 0.005) return;
      if (!byTenant[invoice.tenantId]) byTenant[invoice.tenantId] = { tenantId: invoice.tenantId, balance: 0, count: 0 };
      byTenant[invoice.tenantId].balance = round2(byTenant[invoice.tenantId].balance + invoice.balance);
      byTenant[invoice.tenantId].count += 1;
    });
    var topOutstanding = Object.keys(byTenant).map(function (tenantId) {
      var tenant = getTenant(tenantId);
      return Object.assign({ tenant: tenant }, byTenant[tenantId]);
    }).sort(function (a, b) { return b.balance - a.balance; }).slice(0, 5);
    var totalRooms = dashboard.summary.totalRooms;
    var vacantRate = totalRooms ? (dashboard.summary.vacantRooms / totalRooms) * 100 : 0;
    return Object.assign({}, dashboard, {
      methodTotals: methodTotals,
      statusCounts: statusCounts,
      topOutstanding: topOutstanding,
      vacantRate: vacantRate,
      paymentCount: payments.length,
      invoiceCount: monthInvoices.length
    });
  }

  function paymentInPeriod(payment, period) {
    var start = monthStart(period);
    var end = monthEnd(period);
    return payment.date >= start && payment.date <= end;
  }

  function monthOptions() {
    return getPeriods().slice().reverse();
  }

  RRMS.Store = {
    /* read model ------------------------------------------------------- */
    getMeta: getMeta,
    getLocations: getLocations,
    getLocation: getLocation,
    getRooms: getRooms,
    getRoom: getRoom,
    getTenants: getTenants,
    getTenant: getTenant,
    getTenancies: getTenancies,
    getInvoices: getInvoices,
    getInvoice: getInvoice,
    getInvoiceByNumber: getInvoiceByNumber,
    getInvoiceDetails: getInvoiceDetails,
    getInvoiceView: invoiceView,
    getPayments: getPayments,
    getPaymentsForInvoice: paymentsForInvoice,
    getMeters: getMeters,
    getReadings: getReadings,
    getSettings: getSettings,
    getPeriods: getPeriods,
    monthOptions: monthOptions,
    getDashboard: dashboardData,
    getNotifications: getNotifications,
    getTenantDetails: getTenantDetails,
    getRoomDetails: getRoomDetails,
    getOpenInvoicesForTenant: getOpenInvoicesForTenant,
    tenancyForRoom: tenancyForRoom,
    displayStatus: displayStatus,
    search: search,

    /* filtered list views ---------------------------------------------- */
    getLocationList: getLocationList,
    getRoomList: getRoomList,
    getTenantList: getTenantList,
    getTenancyList: getTenancyList,
    getMeterList: getMeterList,
    getInvoiceList: getInvoiceList,
    getPaymentList: getPaymentList,
    getReportData: getReportData,

    /* locations -------------------------------------------------------- */
    createLocation: createLocation,
    updateLocation: updateLocation,
    deleteLocation: deleteLocation,

    /* rooms ------------------------------------------------------------ */
    createRoom: createRoom,
    updateRoom: updateRoom,
    deleteRoom: deleteRoom,

    /* tenants ---------------------------------------------------------- */
    createTenant: createTenant,
    updateTenant: updateTenant,
    deleteTenant: deleteTenant,

    /* tenancies -------------------------------------------------------- */
    assignTenant: assignTenant,
    updateTenancy: updateTenancy,
    endTenancy: endTenancy,
    deleteTenancy: deleteTenancy,

    /* meter readings --------------------------------------------------- */
    saveReading: saveReading,
    deleteReading: deleteReading,

    /* invoices --------------------------------------------------------- */
    generateInvoices: generateInvoices,
    updateInvoice: updateInvoice,
    cancelInvoice: cancelInvoice,
    deleteInvoice: deleteInvoice,

    /* payments --------------------------------------------------------- */
    recordPayment: recordPayment,
    deletePayment: deletePayment,

    /* settings and demo data ------------------------------------------- */
    updateSettings: updateSettings,
    resetDemoData: resetDemoData,
    exportData: exportData,
    importData: importData,
    hasLocalChanges: hasLocalChanges
  };
})();
