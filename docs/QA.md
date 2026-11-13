# Quality Assurance — Phase 1

Test run: **12 November 2026** · Chrome (headless) · Node.js 26 · PGlite/PostgreSQL 17

Phase 1 covers the Khmer dashboard prototype and the database schema. CRUD screens for
later phases are intentionally out of scope and are marked with phase badges.

---

## 1. Automated suites

### Frontend / Store

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
| Overpayment rejected | pass |
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
node --check js/*.js   # all 12 scripts
```

Result: pass.

Documentation checks: all five Mermaid diagrams (four in `ARCHITECTURE.md`, one ERD)
parse and render with Mermaid 11, and every relative link in `README.md` and `docs/`
resolves.

---

## 2. Browser and responsive matrix

Headless Chrome, deterministic demo session, screenshots captured on 12 Nov 2026.

| Viewport | Language | Checks | Result |
| --- | --- | --- | --- |
| 1440 × 900 | km | Login, KPIs, charts, table, filters, modals, notifications | pass |
| 1440 × 900 | en | Full-shell language switch, charts/table labels | pass |
| 1024 × 768 | km | Sidebar layout, chart grid, invoice table | pass |
| 768 × 1024 | km | Tablet stacking, no overflow | pass |
| 390 × 844 | km | Bottom nav, invoice cards, bottom-sheet modal, search overlay | pass |
| 390 × 844 | en | Mobile labels, no clipped text | pass |
| 360 × 800 | km | Narrow layout, no horizontal scroll | pass |

Functional checks:

- [x] Demo login and one-click demo entry.
- [x] Session redirect from `index.html`; unauthenticated redirect to `login.html`.
- [x] Month filter and property filter update KPIs, charts, property cards, invoices and
      reminders.
- [x] Current-month / last-month quick filters.
- [x] Reset filters.
- [x] Global search with `/` shortcut; room prefix (`បន្ទប់ 201`, `room 201`), tenant name
      and phone, invoice number.
- [x] Search result opens the correct invoice/tenant/room modal.
- [x] Invoice modal shows line items, readings and payment history.
- [x] Tenant and room modals.
- [x] Notification panel and mark-as-read.
- [x] Language switch updates static and dynamic content and persists after reload.
- [x] Print layout at A4: navigation/actions hidden, summary and invoice content intact.
- [x] Roadmap modals for unbuilt modules (rooms, tenants, readings, payments, reports,
      settings, FAB).
- [x] Demo banner hidden outside demo mode; avatar initials correct for demo user.
- [x] Console clean after adding `assets/favicon.svg` (the only 404 was the favicon).
- [x] No horizontal overflow at any tested width.
- [x] Sidebar switches to bottom navigation at 900 px.
- [x] Invoice table becomes mobile cards below the breakpoint.
- [x] Modals become bottom sheets on mobile and restore focus on close.

Screenshots are stored in [`docs/screenshots/`](screenshots/):

- `login-desktop.png`
- `dashboard-desktop-km.png`
- `dashboard-desktop-en.png`
- `invoice-detail-modal.png`
- `dashboard-tablet.png`
- `dashboard-mobile-km.png`

---

## 3. Accessibility spot checks

- Skip link to main content.
- Landmark structure: `aside`, `header`, `main`, `nav`, `footer`.
- Buttons and icon-only controls have `aria-label` or localized accessible labels.
- Modals use `role="dialog"`, `aria-modal`, labelled titles, Escape to close, focus trap
  and focus restoration.
- Charts have `role="img"` and descriptive labels; key figures are also present in text/KPI
  cards.
- Language switch updates `<html lang>`.
- Visible focus styles for keyboard users.
- Form fields have associated labels.
- This is a spot check, not a full WCAG 2.2 audit. A formal audit is recommended before
  production.

---

## 4. Requirement acceptance

| Requirement | Evidence | Status |
| --- | --- | --- |
| Khmer is the default UI language | `<html lang="km">`, `Config.defaultLanguage`, all initial renders | Met |
| English available as secondary | Top-bar switch + persisted preference | Met |
| Centralized translation dictionary | `js/translations.js`, 309 keys, `I18n` runtime | Met |
| Static HTML5/CSS3/vanilla JS | No framework, no bundler | Met |
| Chart.js charts | Four self-hosted charts | Met |
| Noto Sans Khmer | Self-hosted woff2, Khmer/Latin subsets | Met |
| Mobile-first responsive dashboard | 360–1440 px checks, bottom nav, cards, sheets | Met |
| Financial totals derived, not hardcoded | `Store.getDashboard()` calculations; 121 assertions | Met |
| No dead buttons | Unbuilt modules open roadmap modals with phase badges | Met |
| Architecture diagram | `docs/ARCHITECTURE.md` Mermaid diagrams | Met |
| ERD | `docs/ERD.md` Mermaid ER diagram + dictionary | Met |
| PostgreSQL schema | `database/schema.sql`, 17 tables, RLS, triggers | Met |
| Folder structure | README tree + repository layout | Met |
| Translation dictionary deliverable | `js/translations.js` + architecture section | Met |
| Demo mode without credentials | One-click demo; deterministic seed | Met |

---

## 5. Known gaps and deferred tests

- No Supabase adapter yet; live-data integration is untested by definition.
- No visual regression baseline; screenshots are manual references.
- No Safari/Firefox run in this phase. The code uses widely supported ES2017 features and
  no modules, so compatibility risk is low but unverified.
- No load/performance test. The demo dataset is small; database indexes are in place.
- No formal WCAG audit, screen-reader matrix or Khmer text-resize test.
- Print is browser-based; no server-side PDF or Khmer PDF font embedding.
- RLS tests cover admin and tenant; manager/accountant/viewer matrix checks are documented
  but not yet automated as separate sessions.
- Date-dependent demo data regenerates relative to `today`; screenshot dates will drift.
  SQL demo dates also use `current_date`.
- Audit log retention, PITR and backup restore are documented but not rehearsed against a
  live Supabase project.

---

## 6. Reproduce

```powershell
# UI
npm start
# open http://localhost:8765

# Automated checks
npm test
npm install          # once, for PGlite
npm run test:db
```

For the browser smoke test, the original harness used Puppeteer Core with the system Chrome
binary. Screenshots were captured at the viewports listed above; the harness is not part of
the shipped repository to keep the prototype dependency-free at runtime.
