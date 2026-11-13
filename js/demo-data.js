/* ==========================================================================
   RRMS — Deterministic demo dataset (Phase 1)
   Generates a realistic 12-month rental history in the browser. The dashboard
   never hardcodes totals: every figure is derived from these records by
   js/store.js. When Supabase is connected, Store switches to SQL views.
   ========================================================================== */
(function () {
  'use strict';

  window.RRMS = window.RRMS || {};
  var F = RRMS.Format;

  var TENANT_NAMES = [
    { km: 'សុខ ចន្ធា', en: 'Sok Chanthea' },
    { km: 'គង់ វិចិត្រ', en: 'Kong Vichet' },
    { km: 'លី ម៉េងហុង', en: 'Ly Meng Hong' },
    { km: 'ចាន់ សុភា', en: 'Chan Sopheak' },
    { km: 'ហ៊ុន ស្រីនី', en: 'Hun Sreyny' },
    { km: 'ព្រាប វណ្ណា', en: 'Preap Vanna' },
    { km: 'ស៊ុន រតនា', en: 'Sun Rattana' },
    { km: 'ម៉ៅ សុវណ្ណ', en: 'Mao Sovann' },
    { km: 'តាំង ហួយ', en: 'Tang Houy' },
    { km: 'ញ៉ែម សុជាតា', en: 'Nhem Socheata' },
    { km: 'ឌី វីរៈ', en: 'Dy Virak' },
    { km: 'ហ៊ឹម ស្រីល័ក្ខណ៍', en: 'Him Sreyleak' },
    { km: 'សេង ដារា', en: 'Seng Dara' },
    { km: 'កែវ សុខឡា', en: 'Keo Sokha' },
    { km: 'អ៊ឹម ច័ន្ទថា', en: 'Im Chanthy' },
    { km: 'ប៊ុន សំណាង', en: 'Bun Samnang' },
    { km: 'មាស ធីរី', en: 'Meas Thyry' },
    { km: 'យិន សុភាព', en: 'Yin Sopheab' },
    { km: 'សុខ សំអាត', en: 'Sok Sam At' },
    { km: 'លឹម ស៊ីវម៉េង', en: 'Lim Siv Meng' }
  ];

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pad(value, width) {
    return String(value).padStart(width || 2, '0');
  }

  function iso(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(dateString, days) {
    var d = new Date(dateString + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return iso(d);
  }

  function addMonthsToPeriod(period, delta) {
    var p = F.parsePeriod(period);
    var d = new Date(p.year, p.month - 1 + delta, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }

  function dateInPeriod(period, day) {
    var p = F.parsePeriod(period);
    var last = new Date(p.year, p.month, 0).getDate();
    return period + '-' + pad(Math.min(day, last));
  }

  function monthStart(period) { return period + '-01'; }
  function monthEnd(period) {
    var p = F.parsePeriod(period);
    return period + '-' + pad(new Date(p.year, p.month, 0).getDate());
  }

  function build() {
    var today = startOfDay(new Date());
    var todayIso = iso(today);
    var currentPeriod = F.monthKey(today);
    var rng = mulberry32(20261112);

    function randInt(min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
    function random() { return rng(); }
    function pick(list) { return list[Math.floor(rng() * list.length)]; }
    function round2(value) { return Math.round(value * 100) / 100; }

    var periods = [];
    for (var m = 11; m >= 0; m -= 1) periods.push(addMonthsToPeriod(currentPeriod, -m));

    var locations = [
      {
        id: 'loc-1',
        nameKm: 'ទីតាំងទី១',
        nameEn: 'Location 1',
        addressKm: 'សង្កាត់បឹងព្រលឹត ខណ្ឌ៧មករា រាជធានីភ្នំពេញ',
        addressEn: 'Boeng Proluet, Khan 7 Makara, Phnom Penh',
        descriptionKm: 'អគារជួល ២ ជាន់ ចំនួន ១២ បន្ទប់ មានបន្ទប់ទឹកឯកជន។',
        descriptionEn: 'Two-storey rental building with 12 en-suite rooms.',
        contactName: 'លោក សំណាង',
        contactPhone: '012 345 678',
        status: 'active',
        electricityRate: 0.25,
        waterRate: 0.50,
        defaultRent: 125,
        currency: 'USD'
      },
      {
        id: 'loc-2',
        nameKm: 'ទីតាំងទី២',
        nameEn: 'Location 2',
        addressKm: 'សង្កាត់ទួលស្គុល ខណ្ឌសែនសុខ រាជធានីភ្នំពេញ',
        addressEn: 'Tuek Thla, Khan Sen Sok, Phnom Penh',
        descriptionKm: 'ផ្ទះជួល ២ ជាន់ ចំនួន ១០ បន្ទប់ នៅជិតផ្សារទួលស្គុល។',
        descriptionEn: 'Two-storey rental house with 10 rooms near Tuek Thla market.',
        contactName: 'លោកស្រី សុភា',
        contactPhone: '098 765 432',
        status: 'active',
        electricityRate: 0.25,
        waterRate: 0.50,
        defaultRent: 125,
        currency: 'USD'
      }
    ];

    var roomSeeds = [
      /* Location 1 */
      { loc: 0, number: '101', floor: 1, type: 'standard', rent: 125, state: 'occupied' },
      { loc: 0, number: '102', floor: 1, type: 'standard', rent: 125, state: 'occupied' },
      { loc: 0, number: '103', floor: 1, type: 'standard', rent: 125, state: 'vacant' },
      { loc: 0, number: '104', floor: 1, type: 'large', rent: 150, state: 'occupied' },
      { loc: 0, number: '105', floor: 1, type: 'standard', rent: 125, state: 'occupied' },
      { loc: 0, number: '106', floor: 1, type: 'standard', rent: 125, state: 'reserved' },
      { loc: 0, number: '201', floor: 2, type: 'standard', rent: 125, state: 'occupied' },
      { loc: 0, number: '202', floor: 2, type: 'large', rent: 150, state: 'occupied' },
      { loc: 0, number: '203', floor: 2, type: 'standard', rent: 125, state: 'occupied' },
      { loc: 0, number: '204', floor: 2, type: 'small', rent: 110, state: 'occupied' },
      { loc: 0, number: '205', floor: 2, type: 'standard', rent: 125, state: 'maintenance' },
      { loc: 0, number: '206', floor: 2, type: 'standard', rent: 125, state: 'occupied' },
      /* Location 2 */
      { loc: 1, number: '101', floor: 1, type: 'standard', rent: 125, state: 'occupied' },
      { loc: 1, number: '102', floor: 1, type: 'standard', rent: 125, state: 'occupied' },
      { loc: 1, number: '103', floor: 1, type: 'standard', rent: 125, state: 'vacant' },
      { loc: 1, number: '104', floor: 1, type: 'large', rent: 150, state: 'occupied' },
      { loc: 1, number: '105', floor: 1, type: 'standard', rent: 125, state: 'reserved' },
      { loc: 1, number: '201', floor: 2, type: 'standard', rent: 125, state: 'occupied' },
      { loc: 1, number: '202', floor: 2, type: 'standard', rent: 125, state: 'occupied' },
      { loc: 1, number: '203', floor: 2, type: 'standard', rent: 125, state: 'occupied' },
      { loc: 1, number: '204', floor: 2, type: 'standard', rent: 125, state: 'maintenance' },
      { loc: 1, number: '205', floor: 2, type: 'large', rent: 150, state: 'occupied' }
    ];

    var rooms = roomSeeds.map(function (seed, index) {
      var location = locations[seed.loc];
      return {
        id: 'room-' + (seed.loc + 1) + '-' + seed.number,
        locationId: location.id,
        number: seed.number,
        floor: seed.floor,
        type: seed.type,
        monthlyRent: seed.rent,
        status: seed.state,
        notes: seed.state === 'maintenance' ? 'កំពុងជួសជុលបន្ទប់ទឹក និងពិដាន។' : ''
      };
    });

    var occupiedRooms = rooms.filter(function (room) { return room.status === 'occupied'; });

    var tenants = [];
    var tenancies = [];
    var missingReadingRoomIds = {
      'room-1-204': true,
      'room-2-202': true
    };
    var highUsageRoomId = 'room-1-201';

    occupiedRooms.forEach(function (room, index) {
      var name = TENANT_NAMES[index % TENANT_NAMES.length];
      var tenantId = 'tenant-' + pad(index + 1);
      var startOffset = 2 + (index % 11) + randInt(0, 4);
      var startPeriod = addMonthsToPeriod(currentPeriod, -startOffset);
      var startDay = randInt(1, 20);
      var startDate = dateInPeriod(startPeriod, startDay);
      var endDate = null;

      if (index === 5) {
        endDate = addDays(todayIso, 24);
      } else if (index === 12) {
        endDate = addDays(todayIso, 280);
      }

      var tenancy = {
        id: 'tenancy-' + pad(index + 1),
        tenantId: tenantId,
        roomId: room.id,
        locationId: room.locationId,
        startDate: startDate,
        endDate: endDate,
        moveOutDate: null,
        monthlyRent: room.monthlyRent,
        depositAmount: room.monthlyRent,
        depositPaid: room.monthlyRent,
        status: 'active',
        notes: ''
      };

      tenants.push({
        id: tenantId,
        nameKm: name.km,
        nameEn: name.en,
        phone: '0' + pick(['10', '11', '12', '15', '16', '17', '77', '78', '92', '95', '98']) + ' ' +
          randInt(100, 999).toString() + ' ' + randInt(100, 999).toString(),
        email: index % 3 === 0 ? 'tenant' + (index + 1) + '@example.com' : '',
        idNumber: '01' + randInt(1000000, 9999999),
        addressKm: locations[index % 2].addressKm,
        emergencyContactName: TENANT_NAMES[(index + 3) % TENANT_NAMES.length].km,
        emergencyContactPhone: '0' + pick(['10', '11', '12', '92']) + ' ' + randInt(100, 999) + ' ' + randInt(100, 999),
        notes: ''
      });

      tenancies.push(tenancy);
    });

    var meters = [];
    var readings = [];
    var readingId = 1;

    rooms.forEach(function (room) {
      var isLoc2 = room.locationId === 'loc-2';
      var suffix = isLoc2 ? 'B' : 'A';
      var elecMeterId = 'meter-e-' + room.id;
      var waterMeterId = 'meter-w-' + room.id;

      meters.push({
        id: elecMeterId,
        locationId: room.locationId,
        roomId: room.id,
        utility: 'electricity',
        meterNumber: 'E-' + suffix + room.number + '-' + pad(randInt(1, 99)),
        allocationMethod: 'individual',
        status: 'active'
      });
      meters.push({
        id: waterMeterId,
        locationId: room.locationId,
        roomId: room.id,
        utility: 'water',
        meterNumber: 'W-' + suffix + room.number + '-' + pad(randInt(1, 99)),
        allocationMethod: 'individual',
        status: 'active'
      });
    });

    occupiedRooms.forEach(function (room) {
      var location = locations[room.locationId === 'loc-2' ? 1 : 0];
      var tenancy = tenancies.find(function (item) { return item.roomId === room.id; });
      var elecStart = randInt(1000, 5200);
      var waterStart = randInt(60, 460);
      var elecCumulative = elecStart;
      var waterCumulative = waterStart;

      periods.forEach(function (period, periodIndex) {
        if (period === currentPeriod && missingReadingRoomIds[room.id]) return;

        var seasonal = 1 + 0.09 * Math.sin(((periodIndex + 1) / 12) * Math.PI * 2);
        var elecUsage;
        var waterUsage;

        if (room.type === 'large') {
          elecUsage = randInt(135, 245);
          waterUsage = randInt(11, 23);
        } else if (room.type === 'small') {
          elecUsage = randInt(65, 135);
          waterUsage = randInt(5, 13);
        } else {
          elecUsage = randInt(90, 190);
          waterUsage = randInt(8, 18);
        }

        elecUsage = Math.round(elecUsage * seasonal);
        waterUsage = Math.round(waterUsage * (2 - seasonal));

        if (period === currentPeriod && room.id === highUsageRoomId) {
          elecUsage = Math.round(elecUsage * 3.1);
        }

        var readingDate = period === currentPeriod ? todayIso : monthEnd(period);
        var elecPrevious = elecCumulative;
        var elecCurrent = elecPrevious + elecUsage;
        var waterPrevious = waterCumulative;
        var waterCurrent = waterPrevious + waterUsage;

        readings.push({
          id: 'reading-' + pad(readingId++, 4),
          meterId: 'meter-e-' + room.id,
          locationId: room.locationId,
          roomId: room.id,
          tenancyId: tenancy ? tenancy.id : null,
          utility: 'electricity',
          period: period,
          readingDate: readingDate,
          previous: elecPrevious,
          current: elecCurrent,
          consumption: elecUsage,
          rate: location.electricityRate,
          amount: round2(elecUsage * location.electricityRate)
        });
        readings.push({
          id: 'reading-' + pad(readingId++, 4),
          meterId: 'meter-w-' + room.id,
          locationId: room.locationId,
          roomId: room.id,
          tenancyId: tenancy ? tenancy.id : null,
          utility: 'water',
          period: period,
          readingDate: readingDate,
          previous: waterPrevious,
          current: waterCurrent,
          consumption: waterUsage,
          rate: location.waterRate,
          amount: round2(waterUsage * location.waterRate)
        });

        elecCumulative = elecCurrent;
        waterCumulative = waterCurrent;
      });
    });

    function readingFor(roomId, utility, period) {
      return readings.find(function (reading) {
        return reading.roomId === roomId && reading.utility === utility && reading.period === period;
      });
    }

    var invoices = [];
    var payments = [];
    var invoiceCounters = {};
    var paymentCounters = {};
    var paidByInvoice = {};
    var paymentId = 1;

    function nextInvoiceNumber(year) {
      invoiceCounters[year] = (invoiceCounters[year] || 0) + 1;
      return 'INV-' + year + '-' + pad(invoiceCounters[year], 3);
    }

    function nextPaymentNumber(year) {
      paymentCounters[year] = (paymentCounters[year] || 0) + 1;
      return 'PAY-' + year + '-' + pad(paymentCounters[year], 4);
    }

    function addPayment(invoice, amount, date, method, reference) {
      if (amount <= 0) return;
      var p = F.parsePeriod(invoice.billingPeriod);
      var payment = {
        id: 'payment-' + pad(paymentId++, 3),
        paymentNumber: nextPaymentNumber(p.year),
        invoiceId: invoice.id,
        tenantId: invoice.tenantId,
        locationId: invoice.locationId,
        period: invoice.period,
        date: date,
        amount: round2(amount),
        currency: 'USD',
        method: method,
        reference: reference || '',
        notes: '',
        status: 'completed'
      };
      payments.push(payment);
      paidByInvoice[invoice.id] = round2((paidByInvoice[invoice.id] || 0) + amount);
    }

    var methods = ['cash', 'cash', 'cash', 'aba', 'aba', 'acleda', 'bank_transfer', 'other'];

    periods.forEach(function (period, periodIndex) {
      var age = periods.length - 1 - periodIndex;
      var periodYear = F.parsePeriod(period).year;

      occupiedRooms.forEach(function (room, roomIndex) {
        var tenancy = tenancies.find(function (item) { return item.roomId === room.id; });
        if (!tenancy) return;
        if (tenancy.startDate > monthEnd(period)) return;
        if (tenancy.endDate && tenancy.endDate < monthStart(period)) return;

        var electricity = readingFor(room.id, 'electricity', period);
        var water = readingFor(room.id, 'water', period);
        if (!electricity || !water) return;

        var location = locations[room.locationId === 'loc-2' ? 1 : 0];
        var rent = tenancy.monthlyRent;
        var otherCharges = random() < 0.12 ? 5 : 0;
        var discount = 0;
        var lateFee = 0;
        var total = round2(rent + electricity.amount + water.amount + otherCharges - discount + lateFee);
        var issueDate = dateInPeriod(period, 3);
        if (period === currentPeriod && today.getDate() < 3) issueDate = todayIso;
        var dueDate = addMonthsToPeriod(period, 1) + '-05';
        var cancelled = false;

        if (age > 0 && random() < 0.012) {
          cancelled = true;
        }

        var invoice = {
          id: 'invoice-' + pad(invoices.length + 1, 3),
          invoiceNumber: nextInvoiceNumber(periodYear),
          billingPeriod: period,
          locationId: room.locationId,
          roomId: room.id,
          tenancyId: tenancy.id,
          tenantId: tenancy.tenantId,
          issueDate: issueDate,
          dueDate: dueDate,
          rent: rent,
          electricity: {
            previous: electricity.previous,
            current: electricity.current,
            consumption: electricity.consumption,
            rate: electricity.rate,
            amount: electricity.amount
          },
          water: {
            previous: water.previous,
            current: water.current,
            consumption: water.consumption,
            rate: water.rate,
            amount: water.amount
          },
          otherCharges: otherCharges,
          discount: discount,
          lateFee: lateFee,
          previousBalance: 0,
          total: total,
          paid: 0,
          balance: 0,
          status: cancelled ? 'cancelled' : 'finalized',
          currency: 'USD',
          notes: ''
        };

        invoices.push(invoice);

        if (cancelled) return;

        var behaviour;
        if (age === 0) {
          if (roomIndex % 9 === 0) behaviour = 'paid';
          else if (roomIndex % 9 === 1 || roomIndex % 9 === 2) behaviour = 'partial';
          else behaviour = 'unpaid';
        } else if (age <= 2) {
          if (roomIndex % 8 === 0) behaviour = 'unpaid';
          else if (roomIndex % 6 === 0) behaviour = 'partial';
          else behaviour = 'paid';
        } else {
          if ((roomIndex + periodIndex) % 23 === 0) behaviour = 'unpaid';
          else if ((roomIndex + periodIndex) % 17 === 0) behaviour = 'partial';
          else behaviour = 'paid';
        }

        if (behaviour === 'paid' || behaviour === 'partial') {
          var method = pick(methods);
          var reference = method === 'cash' ? '' : method.toUpperCase().slice(0, 6) + '-' + randInt(100000, 999999);
          var payOffset = randInt(2, 12);
          var paymentDate = addDays(issueDate, payOffset);
          if (paymentDate > todayIso) paymentDate = todayIso;
          if (paymentDate < issueDate) paymentDate = issueDate;

          if (behaviour === 'paid') {
            if (random() < 0.14) {
              var first = Math.round(total * 0.6 * 100) / 100;
              var second = Math.round((total - first) * 100) / 100;
              addPayment(invoice, first, paymentDate, method, reference);
              var secondDate = addDays(paymentDate, randInt(1, 4));
              if (secondDate > todayIso) secondDate = todayIso;
              addPayment(invoice, second, secondDate, pick(methods), '');
            } else {
              addPayment(invoice, total, paymentDate, method, reference);
            }
          } else {
            var partial = Math.round(total * (0.35 + random() * 0.3) * 100) / 100;
            addPayment(invoice, partial, paymentDate, method, reference);
          }
        }
      });
    });

    invoices.forEach(function (invoice) {
      var paid = paidByInvoice[invoice.id] || 0;
      invoice.paid = round2(Math.min(paid, invoice.total));
      invoice.balance = invoice.status === 'cancelled' ? 0 : round2(Math.max(invoice.total - paid, 0));
    });

    var systemSettings = {
      companyNameKm: 'អាជីវកម្មជួលបន្ទប់ រាជធានីភ្នំពេញ',
      companyNameEn: 'Phnom Penh Rental Properties',
      currency: 'USD',
      secondaryCurrency: 'KHR',
      exchangeRateKhr: 4100,
      defaultElectricityRate: 0.25,
      defaultWaterRate: 0.50,
      defaultMonthlyRent: 125,
      invoiceDueDay: 5,
      defaultLanguage: 'km',
      dateFormat: 'DD MMMM YYYY'
    };

    var notifications = [];
    var missingReadingRooms = occupiedRooms.filter(function (room) { return missingReadingRoomIds[room.id]; });
    missingReadingRooms.forEach(function (room, index) {
      notifications.push({
        id: 'notif-missing-' + (index + 1),
        type: 'missing_reading',
        roomId: room.id,
        period: currentPeriod,
        isRead: false
      });
    });

    return {
      meta: {
        isDemo: true,
        generatedAt: new Date().toISOString(),
        seed: 20261112,
        seedDate: todayIso,
        currentPeriod: currentPeriod,
        currency: 'USD',
        months: periods.slice()
      },
      locations: locations,
      rooms: rooms,
      tenants: tenants,
      tenancies: tenancies,
      meters: meters,
      readings: readings,
      invoices: invoices,
      payments: payments,
      notifications: notifications,
      settings: systemSettings
    };
  }

  RRMS.DemoData = {
    build: build,
    tenantNames: TENANT_NAMES
  };
})();
