/* ==========================================================================
   RRMS — Formatting helpers
   Money uses Western digits with ISO currency symbols (common on Cambodian
   rental invoices); dates and month names follow the active language.
   ========================================================================== */
(function () {
  'use strict';

  window.RRMS = window.RRMS || {};
  var Config = RRMS.Config;

  var KHMER_MONTHS = [
    'មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា',
    'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'
  ];
  var EN_MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  var KHMER_DAYS = ['អាទិត្យ', 'ចន្ទ', 'អង្គារ', 'ពុធ', 'ព្រហស្បតិ៍', 'សុក្រ', 'សៅរ៍'];

  function lang() {
    return RRMS.I18n ? RRMS.I18n.getLanguage() : Config.defaultLanguage;
  }

  function number(value, decimals) {
    var digits = typeof decimals === 'number' ? decimals : 0;
    if (value === null || value === undefined || isNaN(value)) return '—';
    return new Intl.NumberFormat(Config.locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(value);
  }

  function money(value, options) {
    var opts = options || {};
    var amount = Number(value) || 0;
    if (opts.currency === 'KHR') {
      return number(amount, 0) + ' ៛';
    }
    return '$' + number(amount, 2);
  }

  function compactMoney(value) {
    var amount = Number(value) || 0;
    if (Math.abs(amount) >= 1000) {
      return '$' + number(amount / 1000, 1) + 'K';
    }
    return money(amount);
  }

  function percent(value, decimals) {
    var n = Number(value) || 0;
    return number(n, typeof decimals === 'number' ? decimals : 0) + '%';
  }

  function parsePeriod(period) {
    // Accepts 'YYYY-MM' or 'YYYY-MM-DD'
    var parts = String(period).split('-');
    return {
      year: parseInt(parts[0], 10),
      month: parseInt(parts[1], 10)
    };
  }

  function monthName(monthIndex) {
    return lang() === 'en' ? EN_MONTHS[monthIndex] : KHMER_MONTHS[monthIndex];
  }

  function monthLabel(period) {
    var p = parsePeriod(period);
    if (!p.year || !p.month) return '—';
    return monthName(p.month - 1) + ' ' + p.year;
  }

  function monthShort(period) {
    var p = parsePeriod(period);
    if (!p.year || !p.month) return '—';
    if (lang() === 'en') return EN_MONTHS[p.month - 1].slice(0, 3) + ' ' + String(p.year).slice(2);
    return monthName(p.month - 1) + ' ' + String(p.year).slice(2);
  }

  function date(value, options) {
    var opts = options || {};
    if (!value) return '—';
    var d = value instanceof Date ? value : new Date(value + (String(value).length === 10 ? 'T00:00:00' : ''));
    if (isNaN(d.getTime())) return '—';
    var day = d.getDate();
    var year = d.getFullYear();
    if (lang() === 'en') {
      return monthName(d.getMonth()) + ' ' + day + ', ' + year;
    }
    return day + ' ' + monthName(d.getMonth()) + ' ' + year;
  }

  function shortDate(value) {
    if (!value) return '—';
    var d = value instanceof Date ? value : new Date(value + 'T00:00:00');
    if (isNaN(d.getTime())) return '—';
    return number(d.getDate(), 0) + ' ' + monthName(d.getMonth());
  }

  function weekday(value) {
    var d = new Date(value + 'T00:00:00');
    return lang() === 'en'
      ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]
      : KHMER_DAYS[d.getDay()];
  }

  function isoDate(value) {
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return null;
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function monthKey(value) {
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function monthRange(period) {
    var p = parsePeriod(period);
    var lastDay = new Date(p.year, p.month, 0).getDate();
    return {
      start: period + '-01',
      end: period + '-' + String(lastDay).padStart(2, '0'),
      lastDay: lastDay
    };
  }

  function addMonths(period, delta) {
    var p = parsePeriod(period);
    var d = new Date(p.year, p.month - 1 + delta, 1);
    return monthKey(d);
  }

  function humanFileSize(bytes) {
    if (!bytes) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function phone(value) {
    if (!value) return '—';
    var digits = String(value).replace(/\D/g, '');
    if (digits.length === 9) return digits.slice(0, 3) + ' ' + digits.slice(3, 6) + ' ' + digits.slice(6);
    if (digits.length === 10) return digits.slice(0, 3) + ' ' + digits.slice(3, 6) + ' ' + digits.slice(6);
    return value;
  }

  RRMS.Format = {
    number: number,
    money: money,
    compactMoney: compactMoney,
    percent: percent,
    monthName: monthName,
    monthLabel: monthLabel,
    monthShort: monthShort,
    date: date,
    shortDate: shortDate,
    weekday: weekday,
    isoDate: isoDate,
    monthKey: monthKey,
    monthRange: monthRange,
    addMonths: addMonths,
    parsePeriod: parsePeriod,
    humanFileSize: humanFileSize,
    phone: phone,
    KHMER_MONTHS: KHMER_MONTHS
  };
})();
