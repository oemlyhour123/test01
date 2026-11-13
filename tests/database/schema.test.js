/* Functional checks for the RRMS PostgreSQL schema, triggers and RLS. */
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const workspace = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function expectError(db, label, sql, params) {
  try {
    await db.query(sql, params);
    check(label, false, 'no error raised');
  } catch (err) {
    check(label, true);
    console.log(`       ${err.message.split('\n')[0]}`);
  }
}

(async () => {
  const db = new PGlite();
  await db.exec(read('database/local_bootstrap.sql'));
  await db.exec(read('database/schema.sql'));
  await db.exec(read('database/seed.sql'));

  const q = async (sql, params) => (await db.query(sql, params)).rows;

  console.log('\nSeed');
  const counts = (await q(`
    select
      (select count(*) from locations)::int as locations,
      (select count(*) from rooms)::int as rooms,
      (select count(*) from tenants)::int as tenants,
      (select count(*) from tenancies)::int as tenancies,
      (select count(*) from meters)::int as meters,
      (select count(*) from utility_rates)::int as rates,
      (select count(*) from settings)::int as settings
  `))[0];
  check('2 locations', counts.locations === 2, JSON.stringify(counts));
  check('22 rooms', counts.rooms === 22);
  check('16 tenants', counts.tenants === 16);
  check('16 tenancies', counts.tenancies === 16);
  check('44 meters', counts.meters === 44);
  check('4 utility rates', counts.rates === 4);
  check('11 settings', counts.settings === 11);

  const snap = (await q(`select * from v_location_snapshot order by code`));
  check('location snapshot has 22 rooms', snap.reduce((n, r) => n + Number(r.total_rooms), 0) === 22);
  check('16 occupied rooms', snap.reduce((n, r) => n + Number(r.occupied_rooms), 0) === 16);

  console.log('\nInvoice lifecycle');
  const tenancy = (await q(`select * from tenancies where code = 'TN-001'`))[0];
  const invoice = (await q(`
    insert into invoices (
      location_id, room_id, tenancy_id, tenant_id, billing_period, issue_date, due_date
    ) values (
      $1, $2, $3, $4,
      date_trunc('month', current_date)::date,
      current_date,
      (date_trunc('month', current_date) + interval '1 month 4 days')::date
    ) returning *
  `, [tenancy.location_id, tenancy.room_id, tenancy.id, tenancy.tenant_id]))[0];

  check('draft starts at zero', Number(invoice.total_amount) === 0);
  check('document number assigned', /^INV-\d{4}-\d{4}$/.test(invoice.invoice_number), invoice.invoice_number);

  await db.query(`
    insert into invoice_items (invoice_id, item_type, description_km, description_en, quantity, unit_price, amount, sort_order)
    values
      ($1, 'rent', 'ថ្លៃឈ្នួល', 'Monthly rent', 1, 125, 125, 1),
      ($1, 'electricity', 'អគ្គិសនី', 'Electricity', 30, 0.25, 7.50, 2),
      ($1, 'water', 'ទឹក', 'Water', 10, 0.50, 5.00, 3)
  `, [invoice.id]);
  const drafted = (await q(`select * from invoices where id = $1`, [invoice.id]))[0];
  check('line items roll up to header totals', Number(drafted.total_amount) === 137.5, drafted.total_amount);

  const empty = (await q(`
    insert into invoices (location_id, room_id, tenancy_id, tenant_id, billing_period, issue_date, due_date)
    select location_id, room_id, id, tenant_id, date_trunc('month', current_date)::date,
           current_date, current_date + 5
    from tenancies where code = 'TN-002' returning id
  `))[0];
  await expectError(db, 'cannot finalize without items',
    `select public.finalize_invoice($1)`, [empty.id]);
  await db.query(`delete from invoices where id = $1`, [empty.id]);

  const finalized = (await q(`select * from public.finalize_invoice($1)`, [invoice.id]))[0];
  check('finalize sets status', finalized.status === 'finalized', finalized.status);
  check('finalize stamps time', Boolean(finalized.finalized_at));

  await expectError(db, 'finalized rent is immutable',
    `update invoices set rent_amount = 200 where id = $1`, [invoice.id]);
  await expectError(db, 'finalized invoice cannot be deleted',
    `delete from invoices where id = $1`, [invoice.id]);

  console.log('\nPayments');
  const payment1 = (await q(`select * from public.record_payment($1, 50, 'cash')`, [invoice.id]))[0];
  check('payment number assigned', /^PAY-\d{4}-\d{4}$/.test(payment1.payment_number), payment1.payment_number);
  let state = (await q(`select status, amount_paid from invoices where id = $1`, [invoice.id]))[0];
  check('partial payment sets partially_paid', state.status === 'partially_paid' && Number(state.amount_paid) === 50, JSON.stringify(state));

  const payment2 = (await q(`select * from public.record_payment($1, 87.50, 'aba', 'ABA-123456')`, [invoice.id]))[0];
  state = (await q(`select status, amount_paid from invoices where id = $1`, [invoice.id]))[0];
  check('balance payment sets paid', state.status === 'paid' && Number(state.amount_paid) === 137.5, JSON.stringify(state));

  await expectError(db, 'cannot overpay an invoice',
    `select public.record_payment($1, 1, 'cash')`, [invoice.id]);
  await expectError(db, 'cannot void a paid invoice',
    `select public.void_invoice($1, 'test')`, [invoice.id]);
  await expectError(db, 'allocations cannot be updated',
    `update payment_allocations set amount = 1 where payment_id = $1`, [payment1.id]);
  await expectError(db, 'payments cannot be deleted',
    `delete from payments where id = $1`, [payment1.id]);

  const allocations = (await q(`select * from payment_allocations where payment_id = $1`, [payment1.id]))[0];
  await db.query(`delete from payment_allocations where id = $1`, [allocations.id]);
  state = (await q(`select status, amount_paid from invoices where id = $1`, [invoice.id]))[0];
  check('removing allocation reopens balance', state.status === 'partially_paid' && Number(state.amount_paid) === 87.5, JSON.stringify(state));

  // Restore the allocation and void the payment path.
  await db.query(`insert into payment_allocations (payment_id, invoice_id, amount) values ($1, $2, 50)`, [payment1.id, invoice.id]);
  await expectError(db, 'payment with allocations cannot be voided',
    `update payments set status = 'void', void_reason = 'test' where id = $1`, [payment1.id]);

  console.log('\nVoid invoice');
  const inv2 = (await q(`
    insert into invoices (location_id, room_id, tenancy_id, tenant_id, billing_period, issue_date, due_date)
    select location_id, room_id, id, tenant_id, (date_trunc('month', current_date) - interval '1 month')::date,
           current_date, current_date + 5
    from tenancies where code = 'TN-002' returning *
  `))[0];
  await db.query(`
    insert into invoice_items (invoice_id, item_type, description_km, description_en, quantity, unit_price, amount)
    values ($1, 'rent', 'ថ្លៃឈ្នួល', 'Monthly rent', 1, 125, 125)
  `, [inv2.id]);
  await db.query(`select public.finalize_invoice($1)`, [inv2.id]);
  const voided = (await q(`select * from public.void_invoice($1, 'Duplicate invoice')`, [inv2.id]))[0];
  check('void requires and stores a reason', voided.status === 'void' && voided.void_reason === 'Duplicate invoice');
  await expectError(db, 'void invoice is immutable',
    `update invoices set notes = 'x' where id = $1`, [inv2.id]);

  const inv3 = (await q(`
    insert into invoices (location_id, room_id, tenancy_id, tenant_id, billing_period, issue_date, due_date)
    select location_id, room_id, id, tenant_id, (date_trunc('month', current_date) - interval '1 month')::date,
           current_date, current_date + 5
    from tenancies where code = 'TN-002' returning *
  `))[0];
  await db.query(`
    insert into invoice_items (invoice_id, item_type, description_km, description_en, quantity, unit_price, amount)
    values ($1, 'rent', 'ថ្លៃឈ្នួល', 'Monthly rent', 1, 125, 125)
  `, [inv3.id]);
  await db.query(`select public.finalize_invoice($1)`, [inv3.id]);
  const voided3 = (await q(`select * from public.void_invoice($1, 'Reissued in error')`, [inv3.id]))[0];
  check('voided period can be reissued', voided3.status === 'void', voided3.status);

  console.log('\nMeter readings');
  const meter = (await q(`select * from meters where meter_number = 'E-A101-01'`))[0];
  const reading = (await q(`
    insert into meter_readings (
      meter_id, location_id, room_id, tenancy_id, utility, period_start,
      reading_date, previous_reading, current_reading, rate, status
    ) values (
      $1, $2, $3, $4, 'electricity', date_trunc('month', current_date)::date,
      current_date, 5000, 5030, 0.25, 'confirmed'
    ) returning *
  `, [meter.id, meter.location_id, meter.room_id, tenancy.id]))[0];
  check('reading amount computed by trigger', Number(reading.amount) === 7.5 && Number(reading.consumption) === 30, JSON.stringify({ amount: reading.amount, consumption: reading.consumption }));
  await expectError(db, 'confirmed reading cannot be edited',
    `update meter_readings set current_reading = 5100 where id = $1`, [reading.id]);
  await expectError(db, 'confirmed reading cannot be deleted',
    `delete from meter_readings where id = $1`, [reading.id]);

  await db.query(`update meter_readings set status = 'void', notes = 'Wrong reading' where id = $1`, [reading.id]);
  const replacement = (await q(`
    insert into meter_readings (
      meter_id, location_id, room_id, tenancy_id, utility, period_start,
      reading_date, previous_reading, current_reading, rate, status
    ) values (
      $1, $2, $3, $4, 'electricity', date_trunc('month', current_date)::date,
      current_date, 5000, 5035, 0.25, 'draft'
    ) returning *
  `, [meter.id, meter.location_id, meter.room_id, tenancy.id]))[0];
  check('voided meter period can be re-entered', Number(replacement.consumption) === 35, replacement.consumption);
  await db.query(`delete from meter_readings where id = $1`, [replacement.id]);

  console.log('\nRLS');
  await db.query(`insert into auth.users (id, email) values
    ('aaaaaaaa-0000-4000-8000-000000000001', 'admin@rrms.local'),
    ('bbbbbbbb-0000-4000-8000-000000000001', 'tenant1@rrms.local')`);
  await db.query(`update profiles set role = 'admin', full_name = 'Admin' where id = 'aaaaaaaa-0000-4000-8000-000000000001'`);
  await db.query(`update profiles set role = 'tenant', tenant_id = '20000000-0000-4000-8000-000000000001', full_name = 'Sok Chanthea' where id = 'bbbbbbbb-0000-4000-8000-000000000001'`);

  await db.exec(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', false)`);
  const adminInvoices = (await q(`select count(*)::int as n from invoices`))[0];
  check('admin sees all invoices through RLS', adminInvoices.n === 3, JSON.stringify(adminInvoices));
  const adminSettings = (await q(`select count(*)::int as n from settings`))[0];
  check('admin sees settings', adminSettings.n === 11);
  const summary = (await q(`select public.dashboard_summary(current_date, null) as s`))[0].s;
  check('dashboard summary returns billed total', Number(summary.billed) === 137.5, JSON.stringify(summary));
  check('dashboard summary occupancy', Number(summary.occupied_rooms) === 16, JSON.stringify(summary));

  await db.query(`select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-000000000001', false)`);
  const tenantInvoices = (await q(`select count(*)::int as n from invoices`))[0];
  check('tenant sees only own invoice', tenantInvoices.n === 1, JSON.stringify(tenantInvoices));
  const tenantSettings = (await q(`select count(*)::int as n from settings`))[0];
  check('tenant cannot see settings', tenantSettings.n === 0);
  await expectError(db, 'tenant cannot insert an invoice',
    `insert into invoices (location_id, room_id, tenancy_id, tenant_id, billing_period, issue_date, due_date)
     values ($1, $2, $3, $4, current_date, current_date, current_date + 5)`,
    [tenancy.location_id, tenancy.room_id, tenancy.id, tenancy.tenant_id]);

  await db.exec(`reset role`);
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  await db.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
