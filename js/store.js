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

  function pad2(value) { return String(value).padStart(2, '0'); }

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
      // Phase 2+: hydrate from Supabase views. The UI contract stays identical.
      data = RRMS.DemoData.build();
      if (window.console) {
        console.warn('[Store] Supabase adapter not wired yet; using demo records.');
      }
    }
    paymentIndex = {};
    data.payments.forEach(function (payment) {
      if (!paymentIndex[payment.invoiceId]) paymentIndex[payment.invoiceId] = [];
      paymentIndex[payment.invoiceId].push(payment);
    });
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

  function monthOptions() {
    return getPeriods().slice().reverse();
  }

  RRMS.Store = {
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
    search: search
  };
})();
