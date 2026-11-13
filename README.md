# RRMS — Residential Rental Management System

**Phases 1–7 delivered** · Khmer-first bilingual interface · PostgreSQL / Supabase-ready schema

RRMS is a rental-management application for small residential landlords in Cambodia. The
entire visible interface defaults to Khmer, with an English option available from the
top bar or the login screen. All seven phases are implemented: dashboard, locations,
rooms, tenants, tenancies, meter readings, invoice generation, payments, reports and
settings — backed by deterministic demo records plus a production-shaped PostgreSQL
schema with row-level security.

![Khmer dashboard](docs/screenshots/dashboard-desktop-km.png)

> **Status:** the interface runs in demo mode. The database schema and seed files are
> complete and tested, but the browser `Store` is not yet wired to Supabase. That adapter
> is the remaining integration task. No Supabase credentials are required to review the
> application.

---

## Quick start

Requirements: **Node.js 18+** (only for the local preview server; there are no runtime
dependencies).

```powershell
npm start
# RRMS preview: http://localhost:8765
```

Open <http://localhost:8765>, then either use the one-click demo button or sign in with:

| Field | Value |
| --- | --- |
| Email | `admin@rrms.local` |
| Password | `rrms2026` |

You can also open `login.html` directly from disk. All scripts are classic IIFEs, so the
prototype works over `file://` as well as a static host.

The session lasts 12 hours. Language, session and sidebar preferences are stored in
`localStorage` under `rrms.lang`, `rrms.session` and `rrms.sidebar.collapsed`.

---

## What is included

### Dashboard

- **Eight live KPI cards** — properties, rooms, occupied rooms, vacant rooms, monthly
  billed revenue, collected payments, outstanding balance and overdue invoices. Every
  figure is derived from the invoice, payment and tenancy records; nothing is hardcoded.
- **Property cards** for each location with occupancy, rent roll and outstanding balance.
- **Four Chart.js charts** — 12-month revenue vs. collections, occupancy doughnut,
  electricity/water consumption and the 12-month outstanding-balance trend.
- **Month and property filters**, quick “current month / last month” chips and reset.
- **Recent invoices table** with status, balance and a full invoice modal (line items,
  meter readings, payment history).
- **Tenant and room detail modals**, reachable from property cards and search results.
- **Global search** (`/` to focus) across rooms, tenants and invoices; supports prefixes
  such as `បន្ទប់ 201` / `room 201`, phone numbers and invoice numbers.
- **Notifications and reminders** — missing readings, overdue invoices, high electricity
  usage and expiring contracts.
- **Khmer / English switch**, persisted between visits.
- **Print layout** for a clean paper summary.
- **Responsive shell** — sidebar on desktop, bottom navigation on mobile, stacked cards,
  mobile invoice cards instead of a wide table, and bottom-sheet modals.
- **No dead buttons.** Every navigation item opens a working module.

### Management modules (Phases 2–7)

All modules are hash routes inside `pages/dashboard.html` and share the dashboard shell,
search, notifications and language switch.

| Route | Module | What you can do |
| --- | --- | --- |
| `#/locations` | Properties | Create/edit/delete locations, see occupancy, rent roll and collected totals |
| `#/rooms` | Rooms | Create/edit/delete rooms; new rooms automatically receive electricity and water meters |
| `#/tenants` | Tenants | Create/edit/delete tenant profiles with Khmer/English names and contact details |
| `#/tenancies` | Tenancies | Assign a tenant to a room, end a tenancy, block overlapping occupancy |
| `#/meters` | Meter readings | Enter current readings per room, see usage and amounts calculated live, save per utility |
| `#/invoices` | Invoices | Generate monthly invoices from tenancies and readings, view line items, record payments |
| `#/payments` | Payments | Browse payments for the selected month, filter by property and method |
| `#/reports` | Reports | KPI cards, revenue/occupancy/utility charts, property performance and top outstanding tenants |
| `#/settings` | Settings | Company profile, currency display, invoice defaults, demo reset and About card |

Behaviour and safety rules:

- Invoice totals are always derived from the tenancy rent plus saved meter readings,
  charges and discounts. No financial figure is entered as a fixed total.
- Destructive actions are rejected when dependent records exist (rooms with tenancy
  history, locations with rooms, invoices with payments, tenancies with invoices).
- Ending a tenancy stops it occupying the room for the current month while preserving
  history.
- All module views, forms, tables, toasts and confirmations are translated through the
  same dictionary, in both languages.

### Persistence in demo mode

Demo CRUD writes to an in-memory dataset and persists a browser-local snapshot under
`rrms.demo.v2`. Reloading the page keeps your changes. The snapshot resets automatically
when the demo seed date changes, and **Settings → Reset demo data** restores the
generated dataset without a page reload.

### Data and documentation

- Deterministic 12-month demo dataset (`js/demo-data.js`, seed `20261112`).
- Single data-access boundary in `js/store.js` for later Supabase integration.
- Centralized km/en dictionaries: **309 base keys** (`js/translations.js`) plus
  **250+ management keys** (`js/translations-extended.js`).
- PostgreSQL schema: **17 tables, 19 enums, 10 views, 47 RLS policies, 30 triggers**.
- Base seed and optional 12-month demo history generator.
- Architecture, ERD, operations and QA documentation.

---

## Screens

| Khmer dashboard | English dashboard |
| --- | --- |
| ![Khmer](docs/screenshots/dashboard-desktop-km.png) | ![English](docs/screenshots/dashboard-desktop-en.png) |

| Invoice detail | Mobile |
| --- | --- |
| ![Invoice modal](docs/screenshots/invoice-detail-modal.png) | ![Mobile](docs/screenshots/dashboard-mobile-km.png) |

| Locations | Rooms |
| --- | --- |
| ![Locations](docs/screenshots/module-locations.png) | ![Rooms](docs/screenshots/module-rooms.png) |

| Tenants | Tenancies |
| --- | --- |
| ![Tenants](docs/screenshots/module-tenants.png) | ![Tenancies](docs/screenshots/module-tenancies.png) |

| Meter readings | Invoices |
| --- | --- |
| ![Meter readings](docs/screenshots/module-meters.png) | ![Invoices](docs/screenshots/module-invoices.png) |

| Payments | Reports |
| --- | --- |
| ![Payments](docs/screenshots/module-payments.png) | ![Reports](docs/screenshots/module-reports.png) |

| Settings | Mobile rooms |
| --- | --- |
| ![Settings](docs/screenshots/module-settings.png) | ![Mobile rooms](docs/screenshots/module-rooms-mobile.png) |

![Reports in English](docs/screenshots/module-reports-en.png)

---

## Demo dataset

The browser dataset is generated at load time relative to **today**, so the dashboard
always has a current month, recent invoices and future contract expiry dates.

- 2 locations, 22 rooms, 16 active tenancies and 44 individual meters.
- 12 months of readings, invoices and payments.
- Current month: 14 of 16 occupied rooms have invoices.
- Intentional operational alerts:
  - Room 1-204 and room 2-202 have **no current-month reading**.
  - Room 1-201 has a **3× electricity spike**.
  - Tenancy TN-006 **expires in 24 days**.
- Room states: 16 occupied, 2 vacant, 2 reserved, 2 maintenance.
- Payment methods: cash, ABA, ACLEDA, bank transfer and other.
- Invoice states: finalized, partially paid and paid; older invoices may be overdue.

The SQL demo generator is separate and deterministic as well. It creates **139 invoices,
124 payments, 278 readings, 96 expense lines, 4 maintenance requests and 6 notifications**
on top of the base seed. See [Database](#database).

### Resetting local UI state

Demo records are generated on first load and then persisted in your browser. To reset
preferences only:

```js
localStorage.removeItem('rrms.lang');
localStorage.removeItem('rrms.session');
localStorage.removeItem('rrms.sidebar.collapsed');
```

To discard every record you created in demo mode, use **Settings → Reset demo data**, or:

```js
localStorage.removeItem('rrms.demo.v2');
```

The demo snapshot is also invalidated automatically when the demo seed date changes.

---

## Project structure

```text
.
├── index.html                  # Redirects to login or dashboard
├── login.html                 # Khmer-first sign-in / demo entry
├── pages/
│   └── dashboard.html         # App shell, dashboard and module view stacks
├── js/
│   ├── config.js              # Demo mode, Supabase placeholders, app constants
│   ├── auth.js                # Demo session + Supabase Auth adapter
│   ├── translations.js        # Centralized km/en dictionary (309 base keys)
│   ├── translations-extended.js # Management module keys (locations → settings)
│   ├── i18n.js                # Translation runtime and DOM binding
│   ├── format.js              # Money, dates, periods, Khmer numerals
│   ├── demo-data.js           # Deterministic 12-month demo generator
│   ├── store.js               # Domain queries, CRUD, persistence and aggregations
│   ├── dashboard.js           # Dashboard rendering, charts, filters, modals
│   ├── manager.js             # Phase 2–7 module views, forms, reports, settings
│   ├── app.js                 # Shell, hash routing, search, notifications, language
│   ├── ui.js                  # Modals, toasts, popovers, focus handling
│   ├── icons.js               # Inline SVG icon set
│   └── login.js               # Login page controller
├── css/
│   ├── khmer-fonts.css        # Self-hosted Noto Sans Khmer @font-face
│   ├── main.css               # Tokens, app shell, sidebar, top bar
│   ├── components.css         # Cards, buttons, modals, toasts, forms
│   ├── dashboard.css          # KPIs, charts, tables, reminders, detail views
│   ├── management.css         # Module layout, tables, filters, forms, settings
│   └── mobile.css             # Responsive shell, mobile cards, print rules
├── assets/
│   ├── favicon.svg
│   ├── fonts/NotoSansKhmer/   # Self-hosted woff2 (Khmer + Latin)
│   └── vendor/chart.umd.min.js
├── database/
│   ├── schema.sql             # PostgreSQL 15+ / Supabase schema
│   ├── seed.sql               # Settings, locations, rooms, tenants, meters, rates
│   ├── seed_demo.sql          # Optional 12-month financial history
│   └── local_bootstrap.sql    # Local PGlite/Postgres auth stub (not for Supabase)
├── tests/
│   ├── store.test.js          # 121 assertions for demo data and Store math
│   ├── management.test.js     # 184 assertions for Phase 2–7 contracts
│   └── database/              # PGlite schema, trigger and RLS tests
├── docs/
│   ├── ARCHITECTURE.md
│   ├── ERD.md
│   ├── OPERATIONS.md
│   ├── QA.md
│   └── screenshots/
└── scripts/
    └── serve.js               # Zero-dependency static server
```

---

## Database

The schema targets **PostgreSQL 15+** and is written for Supabase. It creates:

- 17 core tables: `profiles`, `locations`, `rooms`, `tenants`, `tenancies`, `meters`,
  `meter_readings`, `utility_rates`, `invoices`, `invoice_items`, `payments`,
  `payment_allocations`, `expenses`, `maintenance_requests`, `notifications`, `settings`,
  `audit_logs`.
- 10 reporting views, all `security_invoker` so RLS applies through them.
- 47 row-level-security policies scoped by role and location.
- Document-number sequences, invoice line-item rollups, payment-allocation ledger,
  immutability guards, audit triggers and four application RPCs.

### Apply in Supabase

Run these in the Supabase SQL editor, in order:

1. `database/schema.sql`
2. `database/seed.sql`
3. `database/seed_demo.sql` *(optional demo history)*

Then create the first user through **Authentication → Users**, and promote the profile:

```sql
update public.profiles
set role = 'admin',
    full_name = 'Property Admin'
where id = '<auth-user-uuid>';
```

`database/local_bootstrap.sql` is **only** for local PostgreSQL/PGlite validation. It
creates a stub `auth` schema and the `anon` / `authenticated` / `service_role` roles, so do
not run it in a real Supabase project.

The frontend `Store` still reads the in-browser dataset. Configuring
`js/config.js` with a Supabase URL and anon key prepares authentication, but live data
binding is deferred to the integration phase. The schema, views and RPCs are the contract
for that adapter.

Key database rules:

- Invoices are created as **draft**, receive line items, then are finalized. Finalized
  financial fields are immutable.
- Payments are allocated to one or more invoices through `payment_allocations`. Invoice
  paid/partial status is derived by trigger from allocations.
- Corrections use **void and re-issue**, never edits to posted history. Voiding requires a
  reason and zero remaining allocations.
- Confirmed meter readings cannot be edited or deleted; void and re-enter.
- Every invoice and payment change is written to `audit_logs`.
- Staff roles are `admin`, `manager`, `accountant`, `viewer`; a tenant account can only
  read its own tenancy, invoices, payments, readings and notifications.

Full detail: [ARCHITECTURE.md](docs/ARCHITECTURE.md) · [ERD.md](docs/ERD.md) ·
[OPERATIONS.md](docs/OPERATIONS.md).

---

## Testing

```powershell
npm test            # Store and demo-data assertions (121)
npm run test:phases # Phase 2–7 CRUD, invoicing, reports, settings (184)
npm run test:db     # Schema, trigger, RLS and demo-generator checks (needs npm install)
npm run test:all    # All three suites
```

The database tests use `@electric-sql/pglite`, a WASM PostgreSQL build, so no local
PostgreSQL server is needed. They load `local_bootstrap.sql`, `schema.sql`, `seed.sql`
and `seed_demo.sql`, then exercise:

- invoice draft → finalize → partial payment → paid;
- overpayment, mutation and deletion guards;
- allocation removal and void rules;
- confirmed-reading immutability;
- RLS visibility for an admin and a tenant;
- dashboard summary and reporting views;
- demo-generator counts and idempotence.

`tests/management.test.js` covers the Phase 2–7 contract: location/room/tenant/tenancy
CRUD, automatic meters, overlap rejection, meter-reading math, invoice generation,
payments and balances, report totals, settings persistence and demo reset.

The UI was verified with a 23-check headless-Chrome acceptance suite at 360, 390, 768,
1024 and 1440 px, in both languages, with no console errors and no failed requests. See
[QA.md](docs/QA.md).

---

## Phase roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Architecture, ERD, schema, Khmer dashboard prototype, translations | **Delivered** |
| 2 | Locations, rooms and tenant management | **Delivered** |
| 3 | Meter readings and utility rates | **Delivered** |
| 4 | Billing engine and invoice generation | **Delivered** |
| 5 | Invoice/payment workflows and receipts | **Delivered** |
| 6 | Reports, exports and analytics | **Delivered** |
| 7 | Settings, roles, audit review and production hardening | **Delivered** |

Every navigation item opens a working module. The remaining integration task is the
Supabase data adapter described in [ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Known limitations

- Demo authentication is local-only and **not** a security boundary. Production auth and
  RLS live in Supabase.
- The interface uses browser-local demo records; Supabase data binding is not wired yet.
  Demo edits persist in `localStorage` and reset with **Settings → Reset demo data**.
- USD is the only posting currency; KHR is display-only at a configurable rate.
- One active tenancy per tenant and per room is enforced.
- Shared/master meters exist in the schema but shared-cost allocation is not implemented.
- No SMS/Telegram delivery, file uploads, Khmer PDF engine or scheduled jobs yet.
  Printing uses the browser print dialog.
- Invoice edits after finalization are intentionally impossible; corrections require
  voiding.
- Reports and invoice lists render on screen and in print; CSV/PDF export is not yet
  implemented.

---

## Assets and licences

- **Noto Sans Khmer** — self-hosted woff2, SIL Open Font License.
- **Chart.js 4.4.7** — self-hosted UMD build, MIT License.
- Icons are inline SVGs authored for this project.

No customer data, credentials or financial records are included in this repository.
