/* ==========================================================================
   RRMS â€” Phases 2, 3, 5, 6, 7 store contract tests (Node, no dependencies)
   Run: node tests/management.test.js
   Covers location/room/tenant/tenancy CRUD, meter readings, invoice
   generation, payments, reports, settings, persistence and guards.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
global.window = global;

const memory = {};
global.localStorage = {
  getItem: (key) => (key in memory ? memory[key] : null),
  setItem: (key, value) => { memory[key] = String(value); },
  removeItem: (key) => { delete memory[key]; }
};

['js/config.js', 'js/translations.js', 'js/translations-extended.js', 'js/i18n.js',
  'js/format.js', 'js/demo-data.js', 'js/store.js'].forEach((file) => {
  vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
});

const Store = RRMS.Store;
const F = RRMS.Format;
const meta = Store.getMeta();
const current = meta.currentPeriod;

let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}
function equal(actual, expected, message) {
  assert.strictEqual(actual, expected, message + ' (actual: ' + actual + ', expected: ' + expected + ')');
  checks += 1;
}
function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.005,
    message + ' (actual: ' + actual + ', expected: ' + expected + ')');
  checks += 1;
}
function failWith(result, code, message) {
  equal(result.ok, false, message + ' should fail');
  equal(result.code, code, message + ' code');
}

/* ------------------------------------------------------------ list views */
const locationList = Store.getLocationList();
equal(locationList.length, 2, 'Two locations in the list view');
check(locationList.every((row) => row.totalRooms > 0), 'Every demo location has rooms');
check(locationList.every((row) => row.occupancyRate >= 0 && row.occupancyRate <= 100), 'Occupancy is a percentage');

const allRooms = Store.getRoomList({ status: 'all' });
equal(allRooms.length, 22, 'Room list returns all demo rooms');
const occupiedRooms = Store.getRoomList({ status: 'occupied' });
const vacantRooms = Store.getRoomList({ status: 'vacant' });
equal(occupiedRooms.length + vacantRooms.length <= allRooms.length, true, 'Status filters partition rooms');
check(occupiedRooms.every((row) => !!row.tenancy), 'Occupied rooms always have a tenancy');
check(vacantRooms.every((row) => !row.tenancy), 'Vacant rooms never have a tenancy');

const tenantList = Store.getTenantList({});
check(tenantList.length > 0, 'Tenant list is populated');
check(tenantList.every((row) => row.tenant && row.tenant.phone), 'Tenant rows expose phone numbers');

const tenancyList = Store.getTenancyList({ status: 'active' });
check(tenancyList.length > 0, 'Active tenancies exist');
check(tenancyList.every((row) => row.tenancy.status === 'active'), 'Tenancy status filter works');

const meterList = Store.getMeterList(current, 'all');
equal(meterList.rows.length, 22, 'Meter grid lists every room');
check(meterList.occupiedCount > 0, 'Meter grid counts occupied rooms');

const invoiceList = Store.getInvoiceList({ period: current, status: 'all' });
check(invoiceList.length > 0, 'Current month invoices exist');
check(invoiceList.every((row) => row.billingPeriod === current), 'Invoice period filter works');

const paymentList = Store.getPaymentList({ period: 'all', method: 'all' });
check(paymentList.length > 0, 'Payments exist');
check(paymentList.every((row) => row.payment.status === 'completed'), 'Only completed payments are listed');
check(paymentList.every((row) => /^PAY-\d{4}-\d{4}$/.test(row.payment.paymentNumber)),
  'Payment numbers use the PAY-YYYY-NNNN format');

const report = Store.getReportData(current, 'all');
check(report.summary.totalRooms === 22, 'Reports reuse dashboard totals');
check(typeof report.methodTotals === 'object', 'Reports expose payment method totals');
check(Array.isArray(report.topOutstanding), 'Reports expose top outstanding tenants');
check(report.statusCounts.paid >= 0, 'Reports expose invoice status counts');
check(report.properties.every((property) => typeof property.collected === 'number'),
  'Every property reports its collected amount');
near(report.properties.reduce((total, property) => total + property.collected, 0), report.summary.collected,
  'Property collections add up to the report total');
const monthPayments = Store.getPaymentList({ period: current, method: 'all' });
near(monthPayments.reduce((total, row) => total + row.payment.amount, 0), report.summary.collected,
  'Payments page totals match the dashboard collection figure');

/* ------------------------------------------------------- location create */
failWith(Store.createLocation({}), 'nameRequired', 'Location without a name');
const createdLocation = Store.createLocation({
  nameKm: 'áž‘áž¸ážáž¶áŸ†áž„ážŸáž¶áž€áž›áŸ’áž”áž„',
  nameEn: 'Test Site',
  addressKm: 'áž—áŸ’áž“áŸ†áž–áŸáž‰',
  electricityRate: 0.30,
  waterRate: 0.60,
  defaultRent: 200
});
check(createdLocation.ok, 'Location can be created');
const testLocation = createdLocation.record;
check(/^loc-/.test(testLocation.id), 'New location gets a generated id');
near(testLocation.electricityRate, 0.30, 'Location keeps the electricity rate');
near(testLocation.waterRate, 0.60, 'Location keeps the water rate');
equal(Store.getLocationList().length, 3, 'Location list grew by one');

const updatedLocation = Store.updateLocation(testLocation.id, { nameEn: 'Test Site Updated', status: 'inactive' });
check(updatedLocation.ok, 'Location can be updated');
equal(Store.getLocation(testLocation.id).status, 'inactive', 'Location status update persists');
failWith(Store.updateLocation(testLocation.id, { nameKm: '  ' }), 'nameRequired', 'Location name cannot be blank');
// Re-activate for the rest of the flow.
Store.updateLocation(testLocation.id, { status: 'active' });

/* ----------------------------------------------------------- room create */
failWith(Store.createRoom({ number: 'T-01' }), 'locationRequired', 'Room without a location');
failWith(Store.createRoom({ locationId: testLocation.id }), 'roomNumberRequired', 'Room without a number');
const roomResult = Store.createRoom({
  locationId: testLocation.id,
  number: 'T-01',
  floor: 1,
  type: 'studio',
  monthlyRent: 200
});
check(roomResult.ok, 'Room can be created');
const testRoom = roomResult.record;
equal(testRoom.status, 'vacant', 'New rooms start vacant');
check(/^room-/.test(testRoom.id), 'New room gets a generated id');
equal(Store.getMeters().filter((meter) => meter.roomId === testRoom.id).length, 2,
  'New rooms receive electricity and water meters');
failWith(Store.createRoom({ locationId: testLocation.id, number: 'T-01' }), 'roomNumberDuplicate',
  'Duplicate room number in the same location');
check(Store.createRoom({ locationId: 'loc-1', number: 'T-01' }).ok,
  'The same room number is allowed at another location');
// Remove that duplicate helper room again (it has no history).
const helperRoom = Store.getRoomList({ locationId: 'loc-1' }).find((row) => row.room.number === 'T-01');
if (helperRoom) Store.deleteRoom(helperRoom.room.id);

failWith(Store.updateRoom(testRoom.id, { monthlyRent: -5 }), 'rentInvalid', 'Negative rent');
failWith(Store.updateRoom(testRoom.id, { floor: -1 }), 'floorInvalid', 'Negative floor');
check(Store.updateRoom(testRoom.id, { monthlyRent: 210, floor: 2 }).ok, 'Room can be updated');
near(Store.getRoom(testRoom.id).monthlyRent, 210, 'Updated rent is stored');

const demoRoomWithHistory = Store.getRoomList({ status: 'occupied' })[0].room;
failWith(Store.updateRoom(demoRoomWithHistory.id, { locationId: testLocation.id }), 'roomHasHistory',
  'Room with history cannot move location');

/* --------------------------------------------------------- tenant create */
failWith(Store.createTenant({ nameKm: 'áž‚áŸ’áž˜áž¶áž“áž›áŸáž' }), 'phoneRequired', 'Tenant without a valid phone');
failWith(Store.createTenant({ phone: '012345678' }), 'nameRequired', 'Tenant without a name');
const tenantResult = Store.createTenant({
  nameKm: 'áž¢áŸ’áž“áž€áž‡áž½áž›ážŸáž¶áž€áž›áŸ’áž”áž„',
  nameEn: 'Test Tenant',
  phone: '012 345 678',
  email: 'tenant@example.com',
  idNumber: '123456789'
});
check(tenantResult.ok, 'Tenant can be created');
const testTenant = tenantResult.record;
check(/^tenant-/.test(testTenant.id), 'New tenant gets a generated id');
equal(Store.getTenantList({}).some((row) => row.tenant.id === testTenant.id), true, 'New tenant appears in lists');
failWith(Store.updateTenant(testTenant.id, { nameKm: '' }), 'nameRequired', 'Tenant name cannot be blank');
check(Store.updateTenant(testTenant.id, { email: 'updated@example.com' }).ok, 'Tenant can be updated');

/* ------------------------------------------------------------ tenancies */
failWith(Store.assignTenant({ tenantId: testTenant.id, roomId: 'room-missing' }), 'roomRequired',
  'Assigning to a missing room');
const occupiedRoom = Store.getRoomList({ status: 'occupied' })[0];
failWith(Store.assignTenant({ tenantId: testTenant.id, roomId: occupiedRoom.room.id }), 'roomOccupied',
  'Assigning to an occupied room');
failWith(Store.assignTenant({
  tenantId: testTenant.id,
  roomId: testRoom.id,
  startDate: current + '-20',
  endDate: current + '-05'
}), 'dateOrder', 'End date before start date');

const tenancyResult = Store.assignTenant({
  tenantId: testTenant.id,
  roomId: testRoom.id,
  startDate: current + '-01',
  depositAmount: 210
});
check(tenancyResult.ok, 'Tenant can be assigned to a vacant room');
const testTenancy = tenancyResult.record;
equal(Store.getRoom(testRoom.id).status, 'occupied', 'Room becomes occupied');
near(testTenancy.monthlyRent, 210, 'Tenancy inherits the room rent');
failWith(Store.assignTenant({ tenantId: testTenant.id, roomId: testRoom.id }), 'roomOccupied',
  'The same room cannot hold two active tenancies');
const otherVacant = Store.getRoomList({ status: 'vacant' }).find((row) => row.room.id !== testRoom.id);
if (otherVacant) {
  failWith(Store.assignTenant({ tenantId: testTenant.id, roomId: otherVacant.room.id }), 'tenantOccupied',
    'A tenant cannot hold two active tenancies');
}

/* -------------------------------------------------------------- readings */
failWith(Store.saveReading({ roomId: testRoom.id, utility: 'electricity' }), 'readingCurrentRequired',
  'Reading without a current value');
failWith(Store.saveReading({ roomId: testRoom.id, utility: 'electricity', current: -4 }), 'readingNegative',
  'Negative consumption');
const electricity = Store.saveReading({
  roomId: testRoom.id,
  utility: 'electricity',
  period: current,
  current: 100
});
check(electricity.ok, 'Electricity reading saved');
near(electricity.record.consumption, 100, 'Electricity usage computed from the previous reading');
near(electricity.record.amount, 30, 'Electricity amount uses the location rate');
const water = Store.saveReading({
  roomId: testRoom.id,
  utility: 'water',
  period: current,
  current: 20
});
check(water.ok, 'Water reading saved');
near(water.record.amount, 12, 'Water amount uses the location rate');

const gridRow = Store.getMeterList(current, testLocation.id).rows.find((row) => row.room.id === testRoom.id);
check(!!gridRow.electricity && !!gridRow.water, 'Meter grid exposes both readings');
equal(gridRow.missing.length, 0, 'Saved rooms report no missing readings');

/* --------------------------------------------------------------- invoices */
const generated = Store.generateInvoices({ period: current, locationId: testLocation.id });
check(generated.ok, 'Invoices can be generated');
equal(generated.result.created, 1, 'One invoice created for the test room');
equal(generated.result.missing.length, 0, 'No missing readings for the test room');
const again = Store.generateInvoices({ period: current, locationId: testLocation.id });
equal(again.result.created, 0, 'Second generation is idempotent');
equal(again.result.skipped, 1, 'Existing invoices are skipped');

let testInvoice = Store.getInvoiceList({ period: current }).find((row) => row.roomId === testRoom.id);
check(!!testInvoice, 'Generated invoice appears in the list');
near(testInvoice.total, 252, 'Invoice total is rent plus utilities');
near(testInvoice.balance, 252, 'New invoice balance equals its total');
near(testInvoice.paid, 0, 'New invoice has no payments');
equal(testInvoice.displayStatus, 'unpaid', 'New invoice is unpaid');
equal(Store.getInvoiceDetails(testInvoice.id).items.length, 3, 'Invoice breakdown lists rent, electricity and water');

const updatedInvoice = Store.updateInvoice(testInvoice.id, { otherCharges: 8, discount: 2 });
check(updatedInvoice.ok, 'Invoice can be updated');
near(Store.getInvoice(testInvoice.id).total, 258, 'Charges and discounts recalculate the total');
Store.updateInvoice(testInvoice.id, { otherCharges: 0, discount: 0 });

/* --------------------------------------------------------------- payments */
failWith(Store.recordPayment({ invoiceId: testInvoice.id, amount: 999 }), 'paymentTooLarge',
  'Overpayment is rejected');
failWith(Store.recordPayment({ invoiceId: testInvoice.id, amount: 0 }), 'paymentAmount',
  'Zero payments are rejected');
const firstPayment = Store.recordPayment({
  invoiceId: testInvoice.id,
  amount: 100,
  method: 'aba',
  reference: 'ABA-TEST-1'
});
check(firstPayment.ok, 'Partial payment is recorded');
near(Store.getInvoice(testInvoice.id).paid, 100, 'Paid amount updates');
near(Store.getInvoice(testInvoice.id).balance, 152, 'Balance decreases');
equal(Store.getInvoice(testInvoice.id).displayStatus, 'partial', 'Invoice is partially paid');
failWith(Store.cancelInvoice(testInvoice.id), 'invoicePaid', 'Invoice with a payment cannot be cancelled');

const secondPayment = Store.recordPayment({
  invoiceId: testInvoice.id,
  amount: 152,
  method: 'cash'
});
check(secondPayment.ok, 'Remaining balance can be paid');
near(Store.getInvoice(testInvoice.id).balance, 0, 'Invoice is settled');
equal(Store.getInvoice(testInvoice.id).displayStatus, 'paid', 'Invoice is fully paid');
equal(Store.getPaymentsForInvoice(testInvoice.id).length, 2, 'Both payments are attached to the invoice');
failWith(Store.deleteInvoice(testInvoice.id), 'invoiceHasPayments', 'Invoice with payments cannot be deleted');

check(Store.deletePayment(secondPayment.record.id).ok, 'Second payment can be deleted');
near(Store.getInvoice(testInvoice.id).balance, 152, 'Deleting a payment restores the balance');
check(Store.deletePayment(firstPayment.record.id).ok, 'First payment can be deleted');
near(Store.getInvoice(testInvoice.id).paid, 0, 'All payments removed');

/* ----------------------------------------------------------------- guards */
failWith(Store.deleteTenancy(testTenancy.id), 'tenancyHasInvoices', 'Tenancy with invoices cannot be deleted');
failWith(Store.deleteTenant(testTenant.id), 'tenantHasHistory', 'Tenant with history cannot be deleted');
failWith(Store.deleteRoom(testRoom.id), 'roomHasHistory', 'Room with history cannot be deleted');
failWith(Store.deleteLocation('loc-1'), 'locationHasRooms', 'Location with rooms cannot be deleted');
failWith(Store.deleteLocation(testLocation.id), 'locationHasRooms', 'Test location still owns a room');

/* ------------------------------------------------------------ close-out */
check(Store.deleteInvoice(testInvoice.id).ok, 'Invoice without payments can be deleted');
const ended = Store.endTenancy(testTenancy.id, { endDate: current + '-15' });
check(ended.ok, 'Tenancy can be ended');
equal(Store.getTenancies().find((item) => item.id === testTenancy.id).status, 'ended', 'Tenancy status is ended');
equal(Store.getRoom(testRoom.id).status, 'vacant', 'Room is released after move-out');
equal(Store.tenancyForRoom(testRoom.id, current), null, 'Ended tenancy no longer occupies the room');
failWith(Store.endTenancy(testTenancy.id), 'tenancyNotActive', 'Ending an ended tenancy fails');

check(Store.deleteTenancy(testTenancy.id).ok, 'Tenancy without invoices can be deleted');
check(!Store.getReadings().some((reading) => reading.roomId === testRoom.id && reading.period === current &&
  reading.utility === 'electricity') || Store.deleteReading(
  Store.getReadings().find((reading) => reading.roomId === testRoom.id && reading.utility === 'electricity').id
).ok, 'Electricity reading can be deleted after the invoice is gone');
const waterReading = Store.getReadings().find((reading) => reading.roomId === testRoom.id && reading.utility === 'water');
if (waterReading) check(Store.deleteReading(waterReading.id).ok, 'Water reading can be deleted');
check(Store.deleteRoom(testRoom.id).ok, 'Room can be deleted once history is gone');
check(Store.deleteTenant(testTenant.id).ok, 'Tenant can be deleted once history is gone');
check(Store.deleteLocation(testLocation.id).ok, 'Location can be deleted once it is empty');
equal(Store.getLocationList().length, 2, 'Demo dataset is back to two locations');

/* ------------------------------------------------------------ persistence */
check(Store.hasLocalChanges(), 'Demo edits are persisted locally');
const snapshot = JSON.parse(localStorage.getItem(RRMS.Config.keys.demoData));
equal(snapshot.seedDate, meta.seedDate, 'Snapshot is tied to the demo seed date');
check(Array.isArray(snapshot.data.locations), 'Snapshot stores locations');
check(Array.isArray(snapshot.data.payments), 'Snapshot stores payments');

const exported = Store.exportData();
const parsedExport = JSON.parse(exported);
equal(parsedExport.app, 'RRMS', 'Export identifies the app');
check(Array.isArray(parsedExport.data.rooms), 'Export contains rooms');
failWith(Store.importData('not json'), 'importInvalid', 'Invalid JSON import is rejected');
failWith(Store.importData(JSON.stringify({ data: { locations: [] } })), 'importInvalid',
  'Incomplete import is rejected');

Store.resetDemoData();
equal(Store.hasLocalChanges(), false, 'Reset clears the local snapshot');
equal(Store.getLocations().length, 2, 'Reset restores the demo dataset');
check(Store.importData(exported).ok, 'Valid export can be imported');
equal(Store.getLocations().length, 2, 'Imported data replaces the dataset');

/* --------------------------------------------------------------- settings */
const settings = Store.getSettings();
check(Store.updateSettings({
  companyNameEn: 'RRMS Test',
  defaultElectricityRate: 0.27,
  defaultWaterRate: 0.55,
  invoiceDueDay: 7,
  defaultLanguage: 'en'
}).ok, 'Settings can be updated');
equal(Store.getSettings().companyNameEn, 'RRMS Test', 'Company name saved');
near(Store.getSettings().defaultElectricityRate, 0.27, 'Electricity default saved');
near(Store.getSettings().defaultWaterRate, 0.55, 'Water default saved');
equal(Store.getSettings().invoiceDueDay, 7, 'Due day saved');
equal(Store.getSettings().defaultLanguage, 'en', 'Language default saved');
Store.updateSettings({ invoiceDueDay: settings.invoiceDueDay, defaultLanguage: settings.defaultLanguage });

/* ------------------------------------------------------------- translation */
const dictionary = RRMS.Translations;
['nav.locations', 'nav.rooms', 'nav.tenants', 'nav.meterReadings', 'nav.invoices',
  'nav.payments', 'nav.reports', 'nav.settings', 'locations.add', 'rooms.add', 'tenants.add',
  'tenancies.add', 'meters.save', 'invoices.generate', 'payments.add', 'reports.print',
  'settings.reset', 'error.roomOccupied'].forEach((key) => {
  check(!!dictionary[key] && !!dictionary[key].km && !!dictionary[key].en,
    'Translation key is bilingual: ' + key);
});

console.log('Management tests passed: ' + checks + ' assertions.');
