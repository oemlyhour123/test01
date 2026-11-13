# Quality Assurance — Phases 1–7

Test run: **13 November 2026** · Chrome (headless) · Node.js 26 · PGlite/PostgreSQL 17

All seven delivery phases are implemented: dashboard, locations, rooms, tenants,
tenancies, meter readings, invoice generation, payments, reports and settings. The
remaining deferred item is the Supabase data adapter; the SQL schema it will use is fully
tested.

---

## 1. Automated suites

### Frontend Store (Phase 1 baseline)

```powershell
npm test
# Store smoke tests passed: 121 assertions.
```

Covered:

- demo generator produces 2 locations, 22 rooms, 16 tenants, 16 tenancies and 44 meters;
- invoice amounts equal rent + electricity + water + other − discount + late fee;
- paid + balance equals total for every invoice;
- payment totals never exceed invoice totals;
- occupancy counts match room states;
- location filtering changes totals consistently;
- month filtering returns the correct invoice set;
- current and last-month periods are handled across year boundaries;
- `Store.search()` finds rooms by number and prefix, tenants by km/en name and phone,
  invoices by number and tenant name, and returns newest invoices first;
- money/date/period formatting helpers behave at boundaries;
- notifications and reminders are derived, not hardcoded.

### Management modules (Phases 2–7)

```powershell
npm run test:phases
# Management tests passed: 184 assertions.
```

Covered:

- location create/update/delete, validation and dependent-record rejection;
- room create/update/delete, automatic electricity + water meters, rent inheritance;
- tenant create/update/delete and search;
- tenancy assignment, overlap rejection (`roomOccupied`, `tenantOccupied`), rent and
  deposit defaults, ending a tenancy releases the room for the current month;
- meter reading save/update/delete, consumption and amount math, rate inheritance;
- invoice generation from tenancies + saved readings, missing-reading reporting, totals
  and balances;
- payment recording, overpayment rejection, settlement, deletion reopening the balance;
- report totals (billed, collected, outstanding, method totals, top outstanding, property
  `collected` values) and their reconciliation with the dashboard;
- settings persistence and demo reset;
- payment numbers follow `PAY-YYYY-NNNN`;
- payments-page monthly totals equal the dashboard collection figure.

### Database schema, triggers and RLS

```powershell
npm run test:db
```

#### Schema compile

- 17 tables, 19 enums, 10 views, 47 policies, 30 triggers, 4 sequences.
- `schema.sql`, `seed.sql` and `seed_demo.sql` execute without error on PGlite.
- Views use `security_invoker`.

#### Seed

| Check | Result |
| --- | --- |
| 2 locations | pass |
| 22 rooms (16 occupied, 2 vacant, 2 reserved, 2 maintenance) | pass |
| 16 tenants / 16 active tenancies | pass |
| 44 individual meters | pass |
| 4 utility rates | pass |
| 11 settings | pass |
| Location snapshot room and occupancy totals | pass |

#### Invoice lifecycle

| Check | Result |
| --- | --- |
| Invoice number assigned (`INV-YYYY-NNNN`) | pass |
| Draft total starts at zero | pass |
| Line items roll up to rent/electricity/water/other totals | pass |
| Cannot finalize without line items | pass (rejected) |
| Finalize sets status and timestamp | pass |
| Finalized rent/identity fields immutable | pass (rejected) |
| Finalized invoice cannot be deleted | pass (rejected) |
| Void requires a reason | pass |
| Voided invoice immutable | pass (rejected) |
| Voided tenancy/period can be reissued | pass |

#### Payments and allocations

| Check | Result |
| --- | --- |
| Payment number assigned (`PAY-YYYY-NNNN`) | pass |
| Partial payment → `partially_paid` | pass |
| Balance payment → `paid` | pass |
| Overpayment rejected | pass (rejected) |
| Paid invoice cannot be voided | pass (rejected) |
| Allocations cannot be updated | pass (rejected) |
| Payments cannot be deleted | pass (rejected) |
| Deleting an allocation reopens the invoice | pass |
| Payment with allocations cannot be voided | pass (rejected) |

#### Meter readings

| Check | Result |
| --- | --- |
| Consumption generated from previous/current | pass |
| Amount computed by trigger from rate | pass |
| Confirmed reading cannot be edited | pass (rejected) |
| Confirmed reading cannot be deleted | pass (rejected) |
| Voided meter/period can be re-entered | pass |

#### RLS

| Check | Result |
| --- | --- |
| Admin sees all invoices | pass (3 during test) |
| Admin sees settings | pass (11) |
| Tenant sees only own invoice | pass (1) |
| Tenant cannot see settings | pass (0) |
| Tenant cannot insert an invoice | pass (rejected) |
| `dashboard_summary` returns correct billed/occupancy | pass |

#### Demo generator

| Check | Result |
| --- | --- |
| 278 readings, 139 invoices, 124 payments | pass |
| 96 expense lines, 4 maintenance requests, 6 notifications | pass |
| Every payment has one allocation | pass |
| Current month: 14 invoices (2 missing readings) | pass |
| Missing readings only rooms 1-204 and 2-202 | pass |
| High-usage spike on room 1-201 | pass |
| Ledger billed = paid + outstanding | pass |
| Monthly financials cover 24 location-months | pass |
| Expiring tenancy and notification created | pass |
| Re-running demo seed adds nothing | pass |
| 960 audit rows created by the history | pass |

### Syntax checks

```powershell
node --check js/*.js
```

Result: pass — all scripts parse.

---

## 2. Browser and responsive matrix

Headless Chrome acceptance suite: **23 checks, 0 failures**, no console errors and no
failed network requests.

| Viewport | Language | Checks | Result |
| --- | --- | --- | --- |
| 1440 × 1000 | km | Dashboard + all nine modules, charts, CRUD flows, screenshots | pass |
| 1440 × 1000 | en | Module headings, reports, labels, no raw keys | pass |
| 1024 × 768 | km | Sidebar layout, module tables, chart grid | pass |
| 768 × 1024 | km | Tablet stacking, module cards, no overflow | pass |
| 390 × 844 | km | Bottom nav, mobile dashboard, module cards, sheets | pass |
| 360 × 800 | km | Narrow layout, no horizontal scroll | pass |

Route coverage (each renders exactly one visible heading and no raw translation keys):

`#/dashboard`, `#/locations`, `#/rooms`, `#/tenants`, `#/tenancies`, `#/meters`,
`#/invoices`, `#/payments`, `#/reports`, `#/settings`.

Functional checks:

- [x] Demo login and one-click demo entry.
- [x] Session redirect from `index.html`; unauthenticated redirect to `login.html`.
- [x] Dashboard month/property filters, quick chips, reset, eight KPI cards and four charts.
- [x] Global search with `/` shortcut; room prefix, tenant name/phone, invoice number.
- [x] Search result opens the correct invoice/tenant/room modal.
- [x] Invoice modal shows line items, readings and payment history.
- [x] Notification panel and mark-as-read.
- [x] Khmer → English → Khmer switch updates static and dynamic module content; persists
      after reload.
- [x] Deep link (`#/invoices`) survives a reload and restores the module view.
- [x] Switching back to `#/dashboard` hides the module stack and restores the dashboard.
- [x] Location created, edited and deleted through the UI.
- [x] Room created through the UI and automatically receives two meters.
- [x] Tenant created and assigned to the room through the UI; room becomes occupied.
- [x] Meter reading entered in the UI: usage and amount update live, save persists.
- [x] Invoice generated for the new tenancy with rent + utility total.
- [x] Payment recorded from the invoice modal and settles the balance.
- [x] Reports render six KPI cards, three charts and property rows with no `NaN`.
- [x] Settings save persists; Reset demo data restores the seed and clears the snapshot.
- [x] No console errors or failed requests during the full run.
- [x] No horizontal overflow at 360, 768, 1024 or 1440 px across all ten routes.
- [x] Module layout visible at every tested width (heading, table/cards, navigation).

Screenshots are stored in [`docs/screenshots/`](screenshots/):

- `login-desktop.png`
- `dashboard-desktop-km.png`
- `dashboard-desktop-en.png`
- `dashboard-mobile-km.png`
- `dashboard-tablet.png`
- `invoice-detail-modal.png`
- `module-locations.png`
- `module-rooms.png`
- `module-rooms-mobile.png`
- `module-tenants.png`
- `module-tenancies.png`
- `module-meters.png`
- `module-invoices.png`
- `module-payments.png`
- `module-reports.png`
- `module-reports-en.png`
- `module-settings.png`

---

## 3. Accessibility spot checks

- Skip link to main content.
- Landmark structure: `aside`, `header`, `main`, `nav`, `footer`.
- Buttons and icon-only controls have `aria-label` or localized accessible labels.
- Modals use `role="dialog"`, `aria-modal`, labelled titles, Escape to close, focus trap
  and focus restoration.
- The inactive view stack is `hidden`, so its headings and controls leave the accessibility
  tree.
- Charts have `role="img"` and descriptive labels; key figures are also present in text/KPI
  cards.
- Language switch updates `<html lang>`.
- Visible focus styles for keyboard users.
- Form fields have associated labels; module tables use real table headers with
  `data-label` cards on mobile.
- This is a spot check, not a full WCAG 2.2 audit. A formal audit is recommended before
  production.

---

## 4. Requirement acceptance

| Requirement | Evidence | Status |
| --- | --- | --- |
| Khmer is the default UI language | `<html lang="km">`, `Config.defaultLanguage`, all initial renders | Met |
| English available as secondary | Top-bar switch + persisted preference | Met |
| Centralized translation dictionary | `js/translations.js` + `js/translations-extended.js`, merged by `I18n` | Met |
| Static HTML5/CSS3/vanilla JS | No framework, no bundler | Met |
| Chart.js charts | Dashboard (4) + reports (3), self-hosted | Met |
| Noto Sans Khmer | Self-hosted woff2, Khmer/Latin subsets | Met |
| Mobile-first responsive app | 360–1440 px checks, bottom nav, cards, sheets | Met |
| Financial totals derived, not hardcoded | Store calculations; 121 + 184 assertions | Met |
| No dead buttons | All nine modules open working views | Met |
| Phase 2: locations, rooms, tenants, tenancies | CRUD screens + tests | Met |
| Phase 3: meter readings | Live usage/amount, save, edit, delete | Met |
| Phase 5: invoices and payments | Generate, view, pay, settle, delete payment | Met |
| Phase 6: reports | KPIs, 3 charts, property performance, top outstanding | Met |
| Phase 7: settings | Company profile, defaults, demo reset, About/version | Met |
| Architecture diagram | `docs/ARCHITECTURE.md` Mermaid diagrams | Met |
| ERD | `docs/ERD.md` Mermaid ER diagram + dictionary | Met |
| PostgreSQL schema | `database/schema.sql`, 17 tables, RLS, triggers | Met |
| Folder structure | README tree + repository layout | Met |
| Demo mode without credentials | One-click demo; deterministic seed + local snapshot | Met |

---

## 5. Known gaps and deferred tests

- No Supabase adapter yet; live-data integration is untested by definition.
- No visual regression baseline; screenshots are manual references.
- No Safari/Firefox run. The code uses widely supported ES2017 features and no modules, so
  compatibility risk is low but unverified.
- No load/performance test. The demo dataset is small; database indexes are in place.
- No formal WCAG audit, screen-reader matrix or Khmer text-resize test.
- Print is browser-based; no server-side PDF or Khmer PDF font embedding.
- RLS tests cover admin and tenant; manager/accountant/viewer matrix checks are documented
  but not yet automated as separate sessions.
- Date-dependent demo data regenerates relative to `today`; screenshot dates will drift.
  SQL demo dates also use `current_date`.
- Audit log retention, PITR and backup restore are documented but not rehearsed against a
  live Supabase project.
- Reports and invoice lists are screen/print only; CSV/PDF export is deferred.
- Demo writes are browser-local and not multi-user; two devices do not share records.

---

## 6. Reproduce

```powershell
# UI
npm start
# open http://localhost:8765

# Automated checks
npm test
npm run test:phases
npm install          # once, for PGlite
npm run test:db
npm run test:all     # all three suites
```

The browser acceptance harness used Puppeteer Core with the system Chrome binary at the
viewports listed above. It is kept outside the shipped repository to keep the application
dependency-free at runtime.
