/* ==========================================================================
   RRMS — Store smoke tests (Node, no dependencies)
   Run: node tests/store.test.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
global.window = global;

// Minimal storage stub so the i18n runtime can initialise outside a browser.
const memory = {};
global.localStorage = {
  getItem: (key) => (key in memory ? memory[key] : null),
  setItem: (key, value) => { memory[key] = String(value); },
  removeItem: (key) => { delete memory[key]; }
};

['js/config.js', 'js/translations.js', 'js/i18n.js', 'js/format.js', 'js/demo-data.js', 'js/store.js'].forEach((file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  vm.runInThisContext(source, { filename: file });
});

// I18n defaults to Khmer; no DOM initialisation is needed for data tests.

const Store = RRMS.Store;
const F = RRMS.Format;
const meta = Store.getMeta();
const locations = Store.getLocations();
const rooms = Store.getRooms();
const tenants = Store.getTenants();
const invoices = Store.getInvoices();
const payments = Store.getPayments();

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sum(list, mapper) {
  return round2(list.reduce((total, item) => total + (mapper ? mapper(item) : item), 0));
}

let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function equal(actual, expected, message) {
  assert.strictEqual(actual, expected, message + ' (actual: ' + actual + ', expected: ' + expected + ')');
  checks += 1;
}

/* --------------------------------------------------------------- dataset */
equal(locations.length, 2, 'Two demo properties');
equal(rooms.length, 22, '22 demo rooms');
equal(tenants.length, 16, '16 active tenancies/tenants');
equal(meta.currentPeriod.length, 7, 'Current period is YYYY-MM');
check(meta.months.length === 12, '12 months of demo history');
check(Store.getMeters().length === rooms.length * 2, 'Every room has two meters');
check(invoices.length > 100, 'A full year of invoices is generated');
check(payments.length > 0, 'Payments are generated');

/* -------------------------------------------------------- company settings */
const settings = Store.getSettings();
equal(settings.currency, 'USD', 'Default currency is USD');
check(settings.exchangeRateKhr > 0, 'KHR exchange rate is configured');

/* ------------------------------------------------------- dashboard totals */
const dashboard = Store.getDashboard({ period: meta.currentPeriod, locationId: 'all' });
const currentInvoices = invoices.filter((invoice) =>
  invoice.billingPeriod === meta.currentPeriod && invoice.status !== 'cancelled' && invoice.status !== 'draft');
const currentPayments = payments.filter((payment) =>
  payment.status === 'completed' && payment.date >= meta.currentPeriod + '-01' && payment.date <= F.monthRange(meta.currentPeriod).end);

equal(dashboard.summary.totalRooms, 22, 'Dashboard totals all rooms');
equal(dashboard.summary.totalLocations, 2, 'Dashboard totals both locations');
equal(dashboard.summary.monthlyBilled, sum(currentInvoices, (invoice) => invoice.total), 'Billed total is derived from invoices');
equal(dashboard.summary.collected, sum(currentPayments, (payment) => payment.amount), 'Collected total is derived from completed payments');

const today = F.isoDate(new Date());
const expectedOverdue = invoices.filter((invoice) =>
  !['cancelled', 'draft'].includes(invoice.status) &&
  invoice.billingPeriod <= meta.currentPeriod &&
  invoice.dueDate < today &&
  invoice.balance > 0.005).length;
equal(dashboard.summary.overdueCount, expectedOverdue, 'Overdue count is derived from open invoices');

const expectedOutstanding = sum(invoices.filter((invoice) =>
  !['cancelled', 'draft'].includes(invoice.status) && invoice.billingPeriod <= meta.currentPeriod).map((invoice) => {
  const paid = sum(payments.filter((payment) =>
    payment.invoiceId === invoice.id && payment.status === 'completed' &&
    payment.date <= today), (payment) => payment.amount);
  return Math.max(invoice.total - paid, 0);
}));

equal(dashboard.summary.outstanding, round2(expectedOutstanding), 'Outstanding total is derived from balances');

const occupancy = dashboard.occupancy;
equal(occupancy.occupied + occupancy.vacant + occupancy.other, 22, 'Occupancy breakdown covers every room');
equal(occupancy.occupied, 16, '16 occupied rooms in the current month');
equal(dashboard.properties.length, 2, 'One property card per location');
equal(sum(dashboard.properties, (property) => property.totalRooms), 22, 'Property room counts add up');
equal(round2(sum(dashboard.properties, (property) => property.billed)), dashboard.summary.monthlyBilled, 'Property billed totals add up');

check(dashboard.recentInvoices.length <= 8, 'Recent invoice list is capped');
check(dashboard.recentInvoices.every((invoice) => invoice.billingPeriod === meta.currentPeriod), 'Recent invoices belong to selected month');
check(dashboard.revenueSeries.length === 6, 'Six months in the revenue chart');
check(dashboard.utilitySeries.length === 6, 'Six months in the utility chart');
check(dashboard.outstandingSeries.length === 6, 'Six months in the outstanding chart');

/* --------------------------------------------------------- location filter */
const locationTwo = Store.getDashboard({ period: meta.currentPeriod, locationId: 'loc-2' });
equal(locationTwo.summary.totalRooms, 10, 'Location 2 has 10 rooms');
equal(locationTwo.properties.length, 1, 'Location filter returns one property');
check(locationTwo.summary.monthlyBilled <= dashboard.summary.monthlyBilled, 'Location billed is part of portfolio billed');

/* ------------------------------------------------------------- statement */
invoices.slice(0, 20).forEach((invoice) => {
  const details = Store.getInvoiceDetails(invoice.id);
  check(details !== null, 'Invoice details resolve');
  const itemsTotal = sum(details.items, (item) => item.amount);
  equal(round2(itemsTotal), invoice.total, 'Invoice line items add to its total ' + invoice.invoiceNumber);
  check(invoice.balance >= 0, 'Balance is never negative');
  equal(round2(invoice.paid + invoice.balance), round2(invoice.status === 'cancelled' ? invoice.paid : invoice.total),
    'Paid plus balance equals total ' + invoice.invoiceNumber);
});

/* ------------------------------------------------------------- reminders */
check(dashboard.reminders.length > 0, 'Operational reminders are produced');
check(dashboard.reminders.some((item) => item.type === 'missing_reading'), 'Missing readings are flagged');
check(dashboard.reminders.some((item) => item.type === 'high_usage'), 'Unusually high usage is flagged');
check(dashboard.reminders.some((item) => item.type === 'expiring_contract'), 'Expiring contract is flagged');

/* ----------------------------------------------------------------- search */
const roomSearch = Store.search('បន្ទប់ 201');
check(roomSearch.rooms.length >= 1, 'Search understands the Khmer "room" prefix');
const invoiceSearch = Store.search(invoices[0].invoiceNumber);
check(invoiceSearch.invoices.length === 1, 'Search finds an invoice by number');
const phoneSearch = Store.search(tenants[0].phone);
check(phoneSearch.tenants.length >= 1, 'Search finds a tenant by phone');
check(Store.search('zzzz-not-found').total === 0, 'Search handles no results');

/* ------------------------------------------------------------ formatting */
check(F.money(1250.5).includes('1,250.50'), 'Money uses grouped decimals');
check(F.monthLabel(meta.currentPeriod).length > 0, 'Month label resolves');
check(F.addMonths('2026-01', -1) === '2025-12', 'Month arithmetic crosses the year boundary');
check(F.phone('012345678').replace(/\s/g, '') === '012345678', 'Phone formatting keeps every digit');

console.log('Store smoke tests passed: ' + checks + ' assertions.');
