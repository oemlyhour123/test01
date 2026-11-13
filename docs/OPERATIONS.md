# Operations Guide

This guide covers running the application, provisioning the database, managing roles,
rebuilding demo data, correcting financial records and deploying to production later.

---

## 1. Run the application locally

### Option A — included server (recommended)

```powershell
npm start          # http://localhost:8765
```

`scripts/serve.js` is a zero-dependency static server with path traversal protection and
correct MIME types for woff2, SVG, JS, CSS and SQL.

### Option B — open from disk

Open `login.html` directly. The app uses classic scripts and self-hosted assets, so it
works over `file://`. Browser print and localStorage still work; some browsers restrict
storage for `file://`, in which case preferences and demo edits do not persist.

### Option C — any static host

Upload the repository root to Netlify, Cloudflare Pages, GitHub Pages, S3 or an internal
web server. No build step is required. Route `/` to `index.html`.

Demo credentials:

```text
admin@rrms.local / rrms2026
```

The session is a local demo object, expires after 12 hours and is not production auth.

After sign-in, every module is reachable from the sidebar/bottom navigation or by hash
route:

```text
#/dashboard   #/locations  #/rooms      #/tenants   #/tenancies
#/meters      #/invoices   #/payments   #/reports   #/settings
```

Demo writes persist in the browser under `rrms.demo.v2`. See
[section 5](#5-demo-data-lifecycle) for reset procedures.

---

## 2. Provision Supabase

### 2.1 Create the project

1. Create a Supabase project (PostgreSQL 15+).
2. Keep the database password and **service-role key** out of the frontend and source
   control. Only the anon key may be shipped to a browser.
3. Open **SQL Editor**.

### 2.2 Apply SQL in order

Run each file as a single script:

```text
1. database/schema.sql       # types, tables, triggers, views, RLS, grants, RPCs
2. database/seed.sql         # 2 locations, 22 rooms, 16 tenancies, meters, rates
3. database/seed_demo.sql    # optional 12-month demo history
```

Do **not** run `database/local_bootstrap.sql` in Supabase. Supabase already provides the
`auth` schema, `auth.uid()` and the `anon` / `authenticated` / `service_role` roles.

With `psql` against a direct (non-pooler) connection:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seed.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seed_demo.sql
```

### 2.3 Create the first administrator

1. **Authentication → Users → Add user** (email + password).
2. The `on_auth_user_created` trigger inserts a `profiles` row with role `viewer`.
3. Promote that user:

```sql
update public.profiles
set role = 'admin',
    full_name = 'Property Admin'
where id = '<auth-user-uuid>';
```

Confirm:

```sql
select p.id, p.full_name, p.role, p.location_id, p.tenant_id, u.email
from public.profiles p
join auth.users u on u.id = p.id;
```

### 2.4 Configure the frontend

Edit `js/config.js`:

```js
demoMode: false,
supabase: {
  url: 'https://<project-ref>.supabase.co',
  anonKey: '<anon-key>',
  jsUrl: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'
}
```

At the time of writing, `auth.js` can use Supabase Auth, but the application `Store` still
reads and writes demo records. Complete the Store adapter before presenting live financial
data. Do not set `demoMode: false` in a production demo until that adapter ships. All
screens already call the Store contract, so the adapter does not require view changes.

---

## 3. Local PostgreSQL / PGlite validation

### PGlite (no server)

```powershell
npm install
npm run test:db
```

The tests create a temporary WASM PostgreSQL database, load `local_bootstrap.sql`,
`schema.sql`, `seed.sql` and `seed_demo.sql`, then exercise triggers, RLS and views.

### Plain PostgreSQL

As a superuser:

```bash
createdb rrms
psql -d rrms -v ON_ERROR_STOP=1 -f database/local_bootstrap.sql
psql -d rrms -v ON_ERROR_STOP=1 -f database/schema.sql
psql -d rrms -v ON_ERROR_STOP=1 -f database/seed.sql
psql -d rrms -v ON_ERROR_STOP=1 -f database/seed_demo.sql
```

`local_bootstrap.sql` creates `auth.users`, `auth.uid()`, the `anon` / `authenticated` /
`service_role` roles and a users table. It is a validation stub, not a production auth
system.

To impersonate a user in a local session:

```sql
set role authenticated;
select set_config('request.jwt.claim.sub', '<profile-uuid>', false);
select count(*) from public.invoices;
reset role;
```

---

## 4. Role and scope management

All role changes should be made by an administrator in the SQL editor or through a future
admin RPC. The `profiles` trigger blocks self-service privilege escalation.

### Location-scoped manager

```sql
update public.profiles
set role = 'manager',
    location_id = (select id from public.locations where code = 'loc-1')
where id = '<user-uuid>';
```

`location_id = null` means all locations (admin-like scope, still subject to role rules).

### Accountant

```sql
update public.profiles
set role = 'accountant',
    location_id = null
where id = '<user-uuid>';
```

### Tenant portal account

```sql
update public.profiles
set role = 'tenant',
    tenant_id = (select id from public.tenants where code = 'T-0001'),
    location_id = null
where id = '<user-uuid>';
```

The check constraint requires `tenant_id` for tenant role and forbids it for staff roles.
A tenant can read only their own tenancy, invoices, payments, readings and notifications.

### Disable an account

```sql
update public.profiles set is_active = false where id = '<user-uuid>';
```

Inactive profiles fail the `rrms_*` helpers, so policies return no rows.

---

## 5. Demo data lifecycle

### Marker

`seed_demo.sql` writes `settings.demo.seeded_at`. If the marker exists, the generator exits
without inserting anything. This makes deploys idempotent.

### Rebuild the SQL demo history

> **Destructive:** this removes all financial history. Use only in a demo/staging database.

```sql
begin;

delete from public.settings where key = 'demo.seeded_at';

truncate table
  public.payment_allocations,
  public.payments,
  public.invoice_items,
  public.invoices,
  public.meter_readings,
  public.expenses,
  public.maintenance_requests,
  public.notifications,
  public.audit_logs
restart identity;

commit;

\i database/seed_demo.sql
```

`seed.sql` does not need to be rerun; it is idempotent and keeps locations, rooms, tenants,
tenancies, meters and rates. If those changed, truncate them in dependency order and rerun
`seed.sql` first.

### Reset only browser state

Demo records are generated on first load and then persisted so module edits survive a
reload. Three levels of reset are available:

```js
// 1. Preferences only
localStorage.removeItem('rrms.lang');
localStorage.removeItem('rrms.session');
localStorage.removeItem('rrms.sidebar.collapsed');

// 2. Discard every demo edit (same as Settings → Reset demo data)
localStorage.removeItem('rrms.demo.v2');

// 3. Everything for this origin
localStorage.clear();
```

The snapshot also invalidates itself when the demo seed date changes, so a redeploy with a
new seed starts from fresh records. Reset demo data rebuilds in place without a page
reload and emits a data-change event so the dashboard and active module refresh.

### Operating workflow

The modules follow the same order in demo mode and in the future live adapter:

1. **Locations** — create the property and set electricity/water rates and default rent.
2. **Rooms** — add rooms; each new room gets an electricity and a water meter.
3. **Tenants** — record the tenant's Khmer/English name and contact details.
4. **Tenancies** — assign the tenant to a room with a start date, rent and deposit.
   Overlapping active tenancies are rejected.
5. **Meter readings** — enter the current reading for each utility before billing. Usage
   and amount calculate live from the previous reading and the location rate.
6. **Invoices** — generate the month's invoices for a property. Rent comes from the
   tenancy; utilities come from saved readings. Missing readings are reported, not
   invented.
7. **Payments** — open an invoice and record a payment. The invoice balance and status
   update immediately.
8. **Reports** — review billed, collected, outstanding, occupancy and utility trends for
   the month.
9. **Settings** — adjust company details, currency display and invoice defaults; reset demo
   data when you want a clean slate.

Deleting a location, room, tenant or tenancy is rejected while dependent financial or
occupancy records exist. End a tenancy instead of deleting it to preserve history.

---

## 6. Correcting financial records

Posted records are immutable by design. Use the following procedures instead of editing
history. All actions are audited.

### 6.1 Unapply a payment from an invoice

```sql
delete from public.payment_allocations
where payment_id = '<payment-uuid>'
  and invoice_id = '<invoice-uuid>';
```

The invoice `amount_paid` decreases and its status recomputes automatically.

### 6.2 Reallocate a payment

```sql
-- 1. Remove the old allocation (if any)
delete from public.payment_allocations
where payment_id = '<payment-uuid>';

-- 2. Allocate to the correct invoice(s); the sum must be <= payment.amount
insert into public.payment_allocations (payment_id, invoice_id, amount)
values ('<payment-uuid>', '<invoice-uuid>', 50.00);
```

### 6.3 Void a payment

A payment can only be voided after all allocations are removed.

```sql
update public.payments
set status = 'void',
    void_reason = 'Cheque returned'
where id = '<payment-uuid>';
```

Never delete a payment. Deletion is blocked by trigger.

### 6.4 Void an invoice

An invoice can only be voided when `amount_paid = 0`.

```sql
select public.void_invoice('<invoice-uuid>', 'Duplicate of INV-2026-0042');
```

If it has payments:

```sql
-- 1. Inspect the allocations and note the payment IDs.
select payment_id, amount
from public.payment_allocations
where invoice_id = '<invoice-uuid>';

-- 2. Remove the allocations (this reopens the invoice balance).
delete from public.payment_allocations
where invoice_id = '<invoice-uuid>';

-- 3. Void each payment listed in step 1 (only possible with no allocations).
update public.payments
set status = 'void', void_reason = 'Invoice voided'
where id in ('<payment-1>', '<payment-2>');

-- 4. Void the now-unpaid invoice.
select public.void_invoice('<invoice-uuid>', 'Reason');
```

A voided invoice keeps its number and allows a corrected invoice for the same
tenancy/period (the uniqueness index excludes void rows).

### 6.5 Correct a meter reading

- **Draft:** update directly.
- **Confirmed:** void it, then insert a corrected reading for the same meter/period.

```sql
update public.meter_readings
set status = 'void', notes = 'Meter read incorrectly'
where id = '<reading-uuid>';

insert into public.meter_readings (
  meter_id, location_id, room_id, tenancy_id, utility, period_start,
  reading_date, previous_reading, current_reading, rate, status
) values ( ... );
```

The live uniqueness index ignores void rows, so re-entry succeeds. The new reading starts
as `draft` and can be confirmed.

### 6.6 Regenerate an invoice

Finalized invoices cannot be edited. Void the invoice, then create a new draft, add line
items, finalize it. Invoice numbers are issued automatically by sequence.

---

## 7. Backup and restore

### Supabase

- Enable **Point-in-Time Recovery** on paid plans.
- Take a manual backup before running schema changes or bulk imports.
- Use the Supabase dashboard backup/restore workflow; verify auth users separately.

### Self-managed PostgreSQL

```bash
# custom-format backup
pg_dump "$DATABASE_URL" --format=custom --file="rrms-$(date +%Y%m%d-%H%M).dump"

# restore into an empty database
pg_restore --clean --if-exists --no-owner --dbname="$TARGET_URL" rrms-20261112-1200.dump
```

Back up after seeding, before a demo, and before any migration. Store dumps encrypted and
outside the web root.

---

## 8. Migrations

The project has no migration framework yet. For later changes:

1. Create `database/migrations/YYYYMMDD_description.sql`.
2. Wrap in `begin; ... commit;`.
3. Add or replace objects idempotently where practical
   (`create or replace function`, `drop policy if exists`, etc.).
4. Test with `npm run test:db` and a restored staging dump.
5. Apply to staging, verify RLS as each role, then production.
6. Record the change in `docs/QA.md` or a changelog.

Never modify `schema.sql` in production after the first deployment; add a migration.

---

## 9. Monitoring and health checks

Run as an administrator (or via the service role on the server):

```sql
-- Property-level health
select * from public.v_location_snapshot order by code;

-- Current month by property
select * from public.v_monthly_financials
where month = date_trunc('month', current_date)::date
order by location_id;

-- Overdue invoices
select invoice_number, room_number, tenant_name_en, balance_due, due_date
from public.v_invoice_ledger
where is_overdue
order by due_date;

-- Missing current-month readings
select r.room_number, l.code
from public.rooms r
join public.locations l on l.id = r.location_id
where r.status = 'occupied'
  and not exists (
    select 1 from public.meter_readings mr
    where mr.room_id = r.id
      and mr.period_start = date_trunc('month', current_date)::date
      and mr.status <> 'void'
  );

-- Unread notifications
select type, count(*) from public.notifications
where not is_read group by type order by 2 desc;

-- RLS enabled everywhere?
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and not rowsecurity;

-- Sequence positions (document numbers)
select last_value from public.invoice_number_seq;
select last_value from public.payment_number_seq;
```

The application does not schedule background jobs. Later integrations should run these on
a schedule:

- generate monthly invoices from confirmed readings;
- create missing-reading and contract-expiry notifications;
- flag overdue invoices (the view derives this without a job);
- send email/Telegram reminders.

---

## 10. Security checklist

Before exposing the system beyond localhost:

- [ ] All 17 tables have RLS enabled.
- [ ] `anon` has no table privileges.
- [ ] `authenticated` can only execute the intended RPCs.
- [ ] Service-role key is server-side only and never committed.
- [ ] Supabase Auth email confirmation and password policy are configured.
- [ ] First admin promoted; every other staff profile has the least required role.
- [ ] Location scopes set for managers/accountants; tenant accounts linked correctly.
- [ ] Test a tenant account: they must see only their own invoice/payment rows.
- [ ] Test a manager account: they must not see the other location.
- [ ] Audit log retention and backup policy agreed.
- [ ] HTTPS enforced; security headers/CSP configured at the host.
- [ ] Uploaded receipts (future) use a private bucket with signed URLs.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `permission denied for table ...` | Missing grant or RLS policy | Check `\dp` / `pg_policies`; confirm the user is `authenticated` and profile is active |
| Query returns zero rows as admin | Profile missing/role viewer/location mismatch | Inspect `profiles`; run `select public.rrms_role(), public.rrms_location()` |
| `new row violates row-level security policy` | Role lacks write scope | Use admin/manager/accountant as appropriate; check location |
| Cannot finalize invoice | No line items, total zero, or already paid | Add items; query `total_amount`; inspect items |
| `Allocation exceeds the invoice balance` | Invoice already paid or amount too high | Refresh balance; reduce allocation |
| `Allocations require a finalized...` | Invoice is draft/void/paid | Finalize first; allocate only to open invoices |
| `Remove allocations before voiding a payment` | Payment still applied | Delete allocations first |
| `Utility rates may not overlap` | Effective dates overlap | Close the previous rate with `effective_to` |
| `Confirmed readings cannot be edited` | Reading already confirmed | Void and re-enter |
| `Cannot allocate a void payment` | Payment status void | Create a new payment |
| Demo seed inserts nothing | `settings.demo.seeded_at` exists | Delete the marker, then rerun |
| Demo edits disappeared | Snapshot removed, seed date changed, or another browser profile | Re-enter data or use Settings → Reset demo data; snapshot is per origin |
| Module shows a raw key like `rooms.title` | Missing dictionary entry | Add the key to `js/translations.js` or `js/translations-extended.js` |
| A module route shows the dashboard | Hash not recognised | Use one of `#/dashboard`, `#/locations`, `#/rooms`, `#/tenants`, `#/tenancies`, `#/meters`, `#/invoices`, `#/payments`, `#/reports`, `#/settings` |
| `auth.uid()` is null in SQL editor | SQL editor has no JWT | Use `set_config` locally; in Supabase use the API as a signed-in user |
| PGlite test cannot find module | Dev dependencies not installed | `npm install` |
| Khmer glyphs broken | Font files missing or wrong MIME | Keep `assets/fonts/` and serve woff2 as `font/woff2` |

---

## 12. Deployment checklist

- [ ] Static frontend uploaded; `index.html` is the entry point.
- [ ] Fonts, Chart.js and CSS load with correct MIME types.
- [ ] Cache headers set (`serve.js` uses `no-store` for development; production may cache
      fingerprint-free assets with a short TTL).
- [ ] Supabase project provisioned and SQL applied in order.
- [ ] Admin auth user created and promoted.
- [ ] Demo data restored or cleared intentionally.
- [ ] RLS tests pass against staging.
- [ ] Backup taken.
- [ ] `js/config.js` contains only the anon key.
- [ ] Browser console clean; tested at 360, 768 and 1440 px.
- [ ] All ten routes load (`#/dashboard` plus the nine modules), including a hard reload
      on a deep link.
- [ ] Demo reset works and clears `rrms.demo.v2`.
- [ ] Print preview checked on A4.
