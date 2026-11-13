# Architecture

RRMS is deliberately split into two deliverables that can evolve independently:

1. a **static, offline-capable Khmer-first application** that runs today; and
2. a **PostgreSQL/Supabase schema** that defines the durable data model, security and
   financial rules for later phases.

The browser currently reads deterministic demo records, persists demo edits locally and
reports every figure from those records. The schema is not yet wired to the application;
the `Store` module is the seam where that integration will happen.

All seven delivery phases are implemented. The interface is one shell with two view
stacks: the dashboard (`#/dashboard`) and the management modules (`#/locations`,
`#/rooms`, `#/tenants`, `#/tenancies`, `#/meters`, `#/invoices`, `#/payments`,
`#/reports`, `#/settings`).

---

## 1. System context

```mermaid
flowchart TB
  subgraph Browser["Browser (static assets, no build step)"]
    Pages["login.html<br/>pages/dashboard.html"]
    Shell["app.js · ui.js · icons.js"]
    I18n["translations.js · translations-extended.js<br/>i18n.js · format.js"]
    Dashboard["dashboard.js<br/>filters · charts · modals"]
    Manager["manager.js<br/>locations · rooms · tenants · tenancies<br/>meters · invoices · payments · reports · settings"]
    Store["store.js<br/>domain queries, CRUD + aggregation"]
    Demo["demo-data.js<br/>deterministic records"]
    Chart["Chart.js 4.4.7<br/>(self-hosted)"]
    Storage[("localStorage<br/>language · session · sidebar<br/>demo snapshot")]
  end

  subgraph Backend["Supabase (target, Phase 2+)"]
    Auth["Supabase Auth"]
    API["PostgREST / RPC"]
    DB[("PostgreSQL 15+<br/>17 tables · 10 views · RLS")]
  end

  Pages --> Shell
  Pages --> I18n
  Pages --> Dashboard
  Pages --> Manager
  Dashboard --> Store
  Manager --> Store
  Store --> Demo
  Store --> Storage
  Dashboard --> Chart
  Manager --> Chart
  Shell --> Storage
  I18n --> Storage

  Store -. "future adapter" .-> API
  Shell -. "auth adapter (present)" .-> Auth
  API --> DB
  Auth --> DB
```

Runtime rules:

- **No build step.** Scripts are classic IIFEs loaded in dependency order. The app works
  from `file://`, a static host, or the included Node preview server.
- **No runtime CDN dependency.** Noto Sans Khmer and Chart.js are self-hosted.
- **No secret in the browser.** Only a Supabase anon key would ever be configured; the
  service-role key must stay server-side.

---

## 2. Frontend layers

| Layer | Files | Responsibility |
| --- | --- | --- |
| Pages | `index.html`, `login.html`, `pages/dashboard.html` | Semantic shells, two view stacks (dashboard + modules), stable element IDs, accessible labels |
| Configuration | `js/config.js` | Demo mode, language defaults, currency, storage keys, phase/version, Supabase placeholders |
| Presentation shell | `js/app.js`, `js/ui.js`, `js/icons.js` | Sidebar/top bar, hash routing, search, notifications, modals, toasts |
| Localization | `js/translations.js`, `js/translations-extended.js`, `js/i18n.js`, `js/format.js` | Central dictionaries (merged at load), DOM binding, language state, money/date/period formats |
| Dashboard | `js/dashboard.js` | Filters, KPIs, property cards, four charts, invoice table, reminders, detail views |
| Management modules | `js/manager.js` | Locations, rooms, tenants, tenancies, readings, invoices, payments, reports, settings |
| Domain/data | `js/store.js` | Joins, totals, balances, occupancy, search, CRUD, local persistence, reminder derivation |
| Demo source | `js/demo-data.js` | Seeded 12-month record generator (seed `20261112`) |
| Auth | `js/auth.js` | Demo session (12 h) and optional Supabase Auth adapter |
| Styling | `css/*.css` | Design tokens, shell, components, dashboard, management modules, responsive and print rules |

### Data flow: dashboard render

```mermaid
sequenceDiagram
  participant U as User
  participant D as dashboard.js
  participant S as store.js
  participant G as demo-data.js
  participant C as Chart.js

  U->>D: Open dashboard
  D->>S: getMeta(), getLocations()
  D->>S: getDashboard({ period, locationId })
  S->>G: build() (once per page load)
  G-->>S: locations, rooms, tenants, readings, invoices, payments
  S-->>D: KPIs, property summaries, 12-month series, invoices, reminders
  D->>C: render revenue, occupancy, utility, outstanding charts
  U->>D: Open invoice
  D->>S: getInvoiceDetails(id)
  S-->>D: invoice + line items + meter readings + payments
```

Every number on the page is calculated from records in `Store`. The dashboard does not
contain hardcoded totals. Changing the month or location re-runs the aggregation.

### Data flow: module write and refresh

```mermaid
sequenceDiagram
  participant U as User
  participant M as manager.js
  participant S as store.js
  participant L as localStorage
  participant D as dashboard.js

  U->>M: Submit create/edit form
  M->>S: createRoom() / saveReading() / recordPayment() …
  S->>S: validate domain rules
  alt invalid
    S-->>M: { ok: false, code }
    M-->>U: localized inline/toast error
  else valid
    S->>L: persist demo snapshot (rrms.demo.v2)
    S-->>M: { ok: true, record }
    S-->>D: rrms:data-change event
    M->>M: re-render the active module
    D->>S: getDashboard(filters)
    D->>D: refresh KPIs, charts and tables
  end
```

Module views are rendered on demand into `#moduleView`; the dashboard lives in
`#dashboardView`. `hashchange` selects exactly one stack, and `.view-stack[hidden]` keeps
the inactive stack out of layout and the accessibility tree.

Demo persistence is a single snapshot:

- the snapshot key is `rrms.demo.v2`;
- it stores a deep copy of the generated dataset after every successful write;
- it is ignored when its `seedDate` no longer matches the generated demo seed;
- **Reset demo data** deletes the key and rebuilds from `demo-data.js` in place.

### Public Store contract

`RRMS.Store` exposes a read/write API. A future Supabase adapter must preserve this shape
so `dashboard.js`, `manager.js` and `app.js` do not change:

```text
-- reads
getMeta()                     getLocations()          getLocation(id)
getRooms()                    getRoom(id)             getTenants()
getTenant(id)                 getTenancies()          getInvoices()
getInvoice(id)                getInvoiceByNumber(n)   getInvoiceDetails(id)
getPayments()                 getPaymentsForInvoice() getMeters()
getReadings()                 getSettings()           getPeriods()
monthOptions()                getDashboard(filters)   getNotifications()
getTenantDetails(id)          getRoomDetails(id)      getOpenInvoicesForTenant(id)
tenancyForRoom(id)            displayStatus(invoice)  search(query)
getLocationList()             getRoomList(f)          getTenantList(f)
getTenancyList(f)             getInvoiceList(f)       getPaymentList(f)
getReportData(period, loc)

-- writes (all return { ok, record } or { ok: false, code, params })
createLocation / updateLocation / deleteLocation
createRoom / updateRoom / deleteRoom
createTenant / updateTenant / deleteTenant
assignTenant / endTenancy / updateTenancy / deleteTenancy
saveReading / deleteReading
generateInvoices / updateInvoice / deleteInvoice
recordPayment / deletePayment
updateSettings / resetDemoData
```

Domain validation lives in `Store` (for example `roomOccupied`, `tenantOccupied`,
`invoiceHasPayments`, `locationHasRooms`). Views translate the returned `code`; they do not
re-implement the rule.

### Responsive behaviour

- Desktop (≥ 901 px): fixed sidebar, top bar, 12-column-ish dashboard grid; module pages
  use summary cards, filter bars and full tables.
- Tablet and mobile (≤ 900 px): the sidebar is replaced by a five-item bottom navigation,
  search becomes an overlay, the invoice table becomes a card list, and detail modals
  become bottom sheets. Summaries stay two-column at 768 px and narrow phones.
- Module tables collapse to labeled cards below 760 px; filter selects stack and forms
  become single-column. Header actions wrap without horizontal scroll.
- Phone (≤ 560 px): tighter spacing, icon-only language control and compact top-bar
  actions.
- Print: navigation, filters and action buttons are hidden; summary, property and invoice
  content remain.
- The layout was verified at 360, 390, 768, 1024 and 1440 px across all ten routes with no
  horizontal overflow.

---

## 3. Bilingual design

The **default and fallback language is Khmer**. English is a secondary option.

- The dictionaries are merged into one namespace at load: `js/translations.js` holds the
  **309 base keys**, `js/translations-extended.js` adds **250+ management keys**
  (locations → settings, form labels, confirmations, demo-text overrides), and
  `js/i18n.js` reads the merged `RRMS.Translations`. Every key has `km` and `en`.
- `data-i18n`, `data-i18n-placeholder`, `data-i18n-title` and `data-i18n-aria-label`
  bind static markup to keys.
- `I18n.t(key, params)` supports `{name}` interpolation; missing keys are logged and
  fall back to the key, while missing English falls back to Khmer.
- `I18n.apply()` updates text and attributes, sets `<html lang>` and `data-lang`, then the
  page re-renders dynamic sections on the `rrms:language` event.
- `Format` uses Western digits with Khmer month/day names and `$` / `៛` symbols. This is
  common on Cambodian rental invoices and avoids digit-conversion ambiguity in accounting.
- Database records carry `name_km` / `name_en`, `address_km` / `address_en`,
  `title_km` / `title_en`, etc., so user-entered data stays bilingual too.
- Language choice persists in `localStorage` (`rrms.lang`); it is a UI preference, not a
  security control.

Adding a key is a one-file change. Adding a third language would require extending the
dictionary shape and `Config.languages`; the application intentionally supports two.

---

## 4. Domain model and financial rules

### Core chain

```text
Location → Room → Tenancy → Tenant
                 ├── Meters → Meter readings
                 └── Invoices → Invoice items
                              ↑
                    Payment allocations ← Payments
```

`invoices` stores tenant/room/tenancy/location snapshots by reference plus billing period
and dates. `invoice_items` is the source of truth for the amount breakdown.

### Invoice lifecycle

```mermaid
stateDiagram-v2
  [*] --> draft: create header
  draft --> draft: add/edit line items
  draft --> finalized: finalize (≥1 item, total > 0)
  finalized --> partially_paid: first allocation
  finalized --> paid: full allocation
  partially_paid --> paid: remaining allocation
  partially_paid --> finalized: allocation removed
  paid --> finalized: all allocations removed
  finalized --> void: void reason, amount_paid = 0
  void --> [*]

  note right of void
    Void also requires zero remaining allocations.
  end note
```

Rules enforced in the database:

- Header totals (`rent_amount`, `electricity_amount`, `water_amount`, `other_charges`,
  `discount_amount`, `late_fee`) are recalculated from line items while the invoice is a
  draft. `total_amount` is a stored generated column, so it cannot drift from its parts.
- `previous_balance` is added to the current invoice total and is not a line item.
- Finalization requires at least one item, a positive total and zero payments.
- After finalization, all financial and identity fields are immutable. Only
  `amount_paid`, `notes` and lifecycle status may change.
- `amount_paid` can only be changed by the payment-allocation trigger
  (`rrms.allocation_write` guard). Direct edits are rejected.
- Status is derived from paid amount: `finalized` (0), `partially_paid` (between),
  `paid` (total). A void requires a reason and zero allocations.
- Deleting invoices is limited to drafts. Finalized documents are never deleted.

### Payments

- A payment belongs to a tenant and location; it is not tied to one invoice.
- `payment_allocations` is a many-to-many ledger between payments and invoices.
- Allocation insert validates: completed payment, finalized/unpaid invoice, matching
  tenant and location, same currency, allocation ≤ invoice balance, and total allocations
  ≤ payment amount.
- Allocations are immutable. A correction deletes the allocation (which reopens the
  invoice), then voids the payment with a reason.
- Payment and allocation changes are audited.

### Meter readings

- One reading per meter per month (`meter_id`, `period_start`).
- `consumption` is a stored generated column (`current − previous`).
- `amount` is set by trigger from `consumption × rate`.
- Readings are entered as `draft`, then `confirmed`. Confirmed readings cannot be edited
  or deleted; void and re-enter.

### Document numbers

Global sequences produce collision-free numbers, prefixed by document year:

```text
INV-2026-0001   PAY-2026-0001   EXP-2026-0001   MNT-2026-0001
```

The year comes from the document date (`issue_date` / `payment_date` / `expense_date`);
maintenance uses the current year. Numbers are unique, readable and independent of UUID
primary keys.

---

## 5. Security model

### Identity and roles

Supabase Auth owns `auth.users`. A trigger creates a `profiles` row for every new user
with the read-only `viewer` role. Roles:

| Role | Intent |
| --- | --- |
| `admin` | Full access, role management, settings, audit |
| `manager` | Rooms, tenants, tenancies, meters, maintenance; scoped to location |
| `accountant` | Readings, invoices, payments, expenses; scoped to location |
| `viewer` | Read-only staff access; scoped to location |
| `tenant` | Own tenancy, invoices, payments, readings and notifications only |

A staff profile may have `location_id = NULL`, meaning “all locations”. Otherwise it is
scoped to one location. A tenant profile must reference a `tenant_id` (enforced by check
constraint).

### RLS matrix

RLS is enabled on **all 17 tables**. Views use `security_invoker = true`.

| Table group | Admin | Manager | Accountant | Viewer | Tenant |
| --- | --- | --- | --- | --- | --- |
| Locations | RW | RW (own) | R | R | own location |
| Rooms | RW | RW (own) | R | R | own room |
| Tenants | RW | RW | R | R | self |
| Tenancies | RW | RW (own) | R | R | own |
| Meters / rates | RW | RW (own) | R | R | own room meters |
| Readings | RW | RW (own) | RW (own) | R | own |
| Invoices / items | RW | RW (own) | RW (own) | R | own |
| Payments / allocations | RW | RW (own) | RW (own) | R | own |
| Expenses | RW | RW (own) | RW (own) | R | — |
| Maintenance | RW | RW (own) | R | R | own reports |
| Notifications | RW | RW (own) | own | own | own / broadcast |
| Settings | RW | R | R | R | — |
| Audit logs | R | — | — | — | — |

“Own” means `location_id` matches the profile scope. Tenant access is expressed through
`tenant_id = rrms_tenant()` or an active/upcoming tenancy for a location or room.

### Defense in depth

- Helper functions (`rrms_role`, `rrms_location`, `rrms_tenant`, `rrms_can_*`,
  `rrms_tenant_*`) are `security definer` with a pinned `search_path`, so policies do not
  recurse through RLS-protected tables.
- `anon` has no table privileges. `authenticated` receives explicit table/sequence grants.
- Function execution is revoked from `PUBLIC` and granted only where required, so the RPC
  surface is deliberate.
- `profiles` updates are protected by a trigger: non-admins cannot change their own role,
  location, tenant link or active flag.
- Audit triggers run as the table owner so clients cannot suppress or forge log rows.
- `service_role` is never used by the browser.

### RPC surface

| Function | Purpose |
| --- | --- |
| `finalize_invoice(uuid)` | Draft → finalized with all guard checks |
| `void_invoice(uuid, text)` | Void with a required reason |
| `record_payment(uuid, numeric, method, text, date, text)` | Create payment + allocation atomically |
| `dashboard_summary(date, uuid)` | JSON month summary for the future adapter |

All are `security invoker`, so caller RLS still applies.

---

## 6. Database structure

- **17 tables**, **19 enums**, **10 views**, **47 policies**, **30 triggers**, 4 sequences.
- No PostgreSQL extensions beyond built-ins (`gen_random_uuid()` is core in PG13+), which
  keeps PGlite validation and Supabase deployment simple.
- Money: `numeric(12,2)`; rates: `numeric(12,4)`. No floating point for financial data.
- Dates: `date` for business dates; `timestamptz` for audit/system timestamps.
- Bilingual text columns default to empty strings, not null, simplifying inserts.
- Partial unique indexes enforce one active tenancy per room and per tenant, and one
  active meter per room/utility.
- Search indexes cover invoice period/location/status, tenant, room, outstanding invoices,
  readings, tenancies, expenses, maintenance and notifications.
- The `updated_at` convention is maintained by trigger.

See [ERD.md](ERD.md) for the entity diagram and table dictionary.

### Reporting views

| View | Use |
| --- | --- |
| `v_room_occupancy` | Room list with current tenant and rent |
| `v_tenancy_overview` | Tenant/room/location join plus days until expiry |
| `v_invoice_ledger` | Invoice totals, balance, display status, overdue flag |
| `v_monthly_financials` | Billed/collected/outstanding/expenses/net by month/location |
| `v_location_snapshot` | Occupancy and rent roll per property |
| `v_latest_readings` | Latest non-void reading per meter |
| `v_expiring_tenancies` | Active contracts ending within 60 days |
| `v_tenant_balances` | Lifetime billed/paid/outstanding per tenant |
| `v_open_maintenance` | Open/in-progress work with assignee |
| `v_utility_rates_current` | Effective rate per location and utility |

---

## 7. Integration path

```mermaid
flowchart LR
  UI["dashboard.js / app.js"] --> Store["store.js contract"]
  Store --> Demo["demo-data.js<br/>(generated records)"]
  Store -. "Phase 2/5 adapter" .-> Client["supabase-js<br/>anon key"]
  Client --> RPC["SQL views + RPCs"]
  RPC --> DB[("PostgreSQL + RLS")]
  Auth["auth.js"] --> SupabaseAuth["Supabase Auth"]
```

Planned steps:

1. Add a `js/supabase-store.js` that implements the existing Store methods using
   `supabase-js`, views and RPCs.
2. Switch `Store` selection in `config.js` based on `isSupabaseConfigured()`.
3. Replace demo session claims with profile data from `profiles` (role, location, tenant).
4. Route every write in `manager.js` through the same `Store` method names; money writes
   go through RPCs.
5. Add realtime notifications only if needed; polling is sufficient at this scale.

The adapter must not bypass RLS or embed a service-role key. Column names in the views are
already shaped for the interface (names, room number, balance, display status).

---

## 8. Key decisions and trade-offs

| Decision | Why | Cost |
| --- | --- | --- |
| Demo dataset in the browser | Reviewable offline, deterministic, no credentials | Not live data; adapter still required |
| Local snapshot for demo CRUD | Demonstrates full workflows without a backend | Browser-local only; resets per device |
| Single `Store` boundary for reads and writes | One seam for the Supabase adapter; views stay dumb | Store grows but rules stay centralized |
| Classic IIFEs, no bundler | Works from `file://`, zero toolchain | Manual script ordering; no tree-shaking |
| Khmer default, English secondary | Matches primary users | Every new string must be added twice |
| `km`/`en` columns in tables | Simple queries, no join for two languages | Adding languages needs schema work |
| `numeric(12,2)` money | Exact accounting arithmetic | Slightly slower than integers |
| Invoice items as source of truth | Consistent printed breakdown | Header writes must go through items |
| Immutable posted invoices | Auditability, trust | Corrections require void/re-issue |
| Payment allocation ledger | One payment can cover several invoices | More complex than `invoice_id` on payment |
| Partial unique indexes for tenancies | DB-level prevention of double occupancy | No historical overlap support yet |
| RLS helpers as security definer | Avoid recursive policies, central logic | Must keep `search_path` pinned |

---

## 9. Phase boundaries

All delivery phases are implemented in the static application:

| Phase | Screens |
| --- | --- |
| 1 | Dashboard, auth shell, schema, documentation |
| 2 | Locations, rooms, tenants, tenancies |
| 3 | Meter readings and live utility math |
| 4 | Invoice generation from tenancies + readings |
| 5 | Invoice detail, payments, balances |
| 6 | Reports with KPI cards, charts and property performance |
| 7 | Settings, demo reset, About/version card |

The remaining boundary is **data**: the browser uses demo records, while the SQL schema and
RPC contract are ready for the Supabase adapter. Adding live data means implementing the
Store contract, not changing the shell, views or translation layer.

See [OPERATIONS.md](OPERATIONS.md) for deployment and [QA.md](QA.md) for verification.
