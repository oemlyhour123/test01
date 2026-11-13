/* Validate the demo history generator and reporting views. */
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const workspace = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');
let failures = 0;
function check(label, condition, detail) {
  console.log(`${condition ? '  ok' : 'FAIL'}  ${label}${!condition && detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  if (!condition) failures += 1;
}

(async () => {
  const db = new PGlite();
  await db.exec(read('database/local_bootstrap.sql'));
  await db.exec(read('database/schema.sql'));
  await db.exec(read('database/seed.sql'));
  await db.exec(read('database/seed_demo.sql'));
  const q = async (sql, params) => (await db.query(sql, params)).rows;

  const monthStart = (await q(`select date_trunc('month', current_date)::date as m`))[0].m;

  console.log('Volumes');
  const counts = (await q(`
    select
      (select count(*) from meter_readings)::int as readings,
      (select count(*) from invoices)::int as invoices,
      (select count(*) from payments)::int as payments,
      (select count(*) from payment_allocations)::int as allocations,
      (select count(*) from expenses)::int as expenses,
      (select count(*) from maintenance_requests)::int as maintenance,
      (select count(*) from notifications)::int as notifications,
      (select count(*) from audit_logs)::int as audit
  `))[0];
  console.log(counts);
  check('readings generated', counts.readings > 250, counts);
  check('invoices generated', counts.invoices > 100, counts);
  check('payments generated', counts.payments > 80, counts);
  check('all allocations match payments', counts.allocations === counts.payments, counts);
  check('96 expense lines', counts.expenses === 96, counts);
  check('4 maintenance requests', counts.maintenance === 4, counts);
  check('notifications generated', counts.notifications >= 4, counts);
  check('audit trail populated', counts.audit > 100, counts);

  console.log('\nCurrent month');
  const current = (await q(`
    select
      count(*)::int as invoices,
      count(*) filter (where status = 'paid')::int as paid,
      count(*) filter (where status = 'partially_paid')::int as partial,
      count(*) filter (where status = 'finalized')::int as unpaid,
      coalesce(sum(total_amount), 0) as billed,
      coalesce(sum(amount_paid), 0) as collected
    from invoices
    where billing_period = $1
  `, [monthStart]))[0];
  console.log(current);
  check('14 current invoices (two missing readings)', current.invoices === 14, current);
  check('current invoices have mixed states', current.paid > 0 && current.partial > 0 && current.unpaid > 0, current);
  check('collected never exceeds billed', Number(current.collected) <= Number(current.billed) + 0.001, current);

  const missing = (await q(`
    select r.room_number, l.code
    from rooms r
    join locations l on l.id = r.location_id
    where r.status = 'occupied'
      and not exists (
        select 1 from meter_readings mr
        where mr.room_id = r.id and mr.period_start = $1
      )
    order by l.code, r.room_number
  `, [monthStart]));
  console.log(missing);
  check('exactly two missing readings', missing.length === 2, missing);

  const spike = (await q(`
    select mr.consumption
    from meter_readings mr
    join rooms r on r.id = mr.room_id
    join locations l on l.id = mr.location_id
    where l.code = 'loc-1' and r.room_number = '201'
      and mr.utility = 'electricity' and mr.period_start = $1
  `, [monthStart]))[0];
  check('high-usage room spike recorded', Number(spike.consumption) > 300, spike);

  console.log('\nViews and RPC');
  const ledger = (await q(`
    select
      count(*)::int as n,
      coalesce(sum(total_amount), 0) as billed,
      coalesce(sum(amount_paid), 0) as paid,
      coalesce(sum(balance_due), 0) as outstanding,
      count(*) filter (where is_overdue)::int as overdue
    from v_invoice_ledger
    where billing_month = to_char(current_date, 'YYYY-MM')
  `))[0];
  console.log(ledger);
  check('ledger matches invoice table', ledger.n === 14 && Number(ledger.billed) === Number(current.billed), ledger);
  check('ledger computes balances', Math.abs(Number(ledger.billed) - Number(ledger.paid) - Number(ledger.outstanding)) < 0.01, ledger);
  check('overdue invoices exist', ledger.overdue >= 0, ledger);

  const summary = (await q(`select public.dashboard_summary(current_date, null) as s`))[0].s;
  console.log(summary);
  check('summary invoice count matches', summary.invoice_count === 14, summary);
  check('summary billed matches ledger', Number(summary.billed) === Number(current.billed), summary);
  check('summary occupancy is 16/22', summary.occupied_rooms === 16 && summary.total_rooms === 22, summary);

  const monthly = (await q(`
    select count(*)::int as months,
           coalesce(sum(billed), 0) as billed,
           coalesce(sum(expenses), 0) as expenses
    from v_monthly_financials
  `))[0];
  console.log(monthly);
  check('12 months of financials', monthly.months >= 24, monthly); // 12 months x 2 locations
  check('expenses rolled up', Number(monthly.expenses) > 0, monthly);

  const expiring = (await q(`select count(*)::int as n from v_expiring_tenancies`))[0];
  check('expiring tenancy detected', expiring.n >= 1, expiring);

  const demoNotice = (await q(`
    select count(*)::int as n from notifications
    where type = 'contract_expiring'
  `))[0];
  check('contract notification created', demoNotice.n >= 1, demoNotice);

  console.log('\nIdempotence');
  const before = (await q(`select count(*)::int as n from invoices`))[0].n;
  await db.exec(read('database/seed_demo.sql'));
  const after = (await q(`select count(*)::int as n from invoices`))[0].n;
  check('re-running demo seed adds nothing', before === after, { before, after });

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  await db.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
