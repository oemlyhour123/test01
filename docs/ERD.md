# Entity Relationship Diagram

The diagram below reflects `database/schema.sql`. `AUTH_USERS` is owned by Supabase Auth;
the other 17 entities are in the `public` schema.

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : provisions
  LOCATIONS ||--o{ PROFILES : scopes
  TENANTS ||--o{ PROFILES : "portal account"

  LOCATIONS ||--o{ ROOMS : contains
  LOCATIONS ||--o{ TENANCIES : hosts
  LOCATIONS ||--o{ METERS : installs
  LOCATIONS ||--o{ UTILITY_RATES : prices
  LOCATIONS ||--o{ INVOICES : bills
  LOCATIONS ||--o{ PAYMENTS : receives
  LOCATIONS ||--o{ EXPENSES : incurs
  LOCATIONS ||--o{ MAINTENANCE_REQUESTS : tracks
  LOCATIONS ||--o{ NOTIFICATIONS : scopes

  ROOMS ||--o{ TENANCIES : rented_by
  ROOMS ||--o{ METERS : metered_by
  ROOMS ||--o{ INVOICES : billed_for
  ROOMS ||--o{ MAINTENANCE_REQUESTS : concerns

  TENANTS ||--o{ TENANCIES : signs
  TENANTS ||--o{ INVOICES : owes
  TENANTS ||--o{ PAYMENTS : makes
  TENANTS ||--o{ MAINTENANCE_REQUESTS : reports

  TENANCIES ||--o{ INVOICES : generates
  TENANCIES ||--o{ METER_READINGS : covers
  TENANCIES ||--o{ MAINTENANCE_REQUESTS : relates_to

  METERS ||--o{ METER_READINGS : records
  METER_READINGS |o--o{ INVOICE_ITEMS : "metered by"

  INVOICES ||--o{ INVOICE_ITEMS : itemizes
  INVOICES ||--o{ PAYMENT_ALLOCATIONS : settled_by
  PAYMENTS ||--o{ PAYMENT_ALLOCATIONS : allocates

  PROFILES ||--o{ NOTIFICATIONS : receives
  PROFILES ||--o{ AUDIT_LOGS : acts
  PROFILES ||--o{ EXPENSES : records
  PROFILES ||--o{ MAINTENANCE_REQUESTS : assigned_to

  AUTH_USERS {
    uuid id PK
    text email
    jsonb raw_user_meta_data
  }

  PROFILES {
    uuid id PK
    user_role role
    uuid location_id FK
    uuid tenant_id FK
    char language
    boolean is_active
  }

  LOCATIONS {
    uuid id PK
    text code UK
    text name_km
    text name_en
    location_status status
    char currency
    text timezone
  }

  ROOMS {
    uuid id PK
    uuid location_id FK
    text room_number
    integer floor
    room_type room_type
    numeric monthly_rent
    room_status status
  }

  TENANTS {
    uuid id PK
    text code UK
    text name_km
    text name_en
    text phone
    tenant_status status
  }

  TENANCIES {
    uuid id PK
    text code UK
    uuid tenant_id FK
    uuid room_id FK
    uuid location_id FK
    date start_date
    date end_date
    numeric monthly_rent
    numeric deposit_amount
    tenancy_status status
  }

  METERS {
    uuid id PK
    uuid location_id FK
    uuid room_id FK
    utility_type utility
    text meter_number UK
    meter_allocation allocation_method
    meter_status status
  }

  UTILITY_RATES {
    uuid id PK
    uuid location_id FK
    utility_type utility
    numeric rate
    date effective_from
    date effective_to
  }

  METER_READINGS {
    uuid id PK
    uuid meter_id FK
    uuid location_id FK
    uuid room_id FK
    uuid tenancy_id FK
    utility_type utility
    date period_start
    numeric previous_reading
    numeric current_reading
    numeric consumption
    numeric rate
    numeric amount
    reading_status status
  }

  INVOICES {
    uuid id PK
    text invoice_number UK
    uuid location_id FK
    uuid room_id FK
    uuid tenancy_id FK
    uuid tenant_id FK
    date billing_period
    date issue_date
    date due_date
    numeric total_amount
    numeric amount_paid
    invoice_status status
  }

  INVOICE_ITEMS {
    uuid id PK
    uuid invoice_id FK
    invoice_item_type item_type
    numeric quantity
    numeric unit_price
    numeric amount
    uuid meter_reading_id FK
  }

  PAYMENTS {
    uuid id PK
    text payment_number UK
    uuid location_id FK
    uuid tenant_id FK
    date payment_date
    numeric amount
    payment_method method
    payment_status status
  }

  PAYMENT_ALLOCATIONS {
    uuid id PK
    uuid payment_id FK
    uuid invoice_id FK
    numeric amount
  }

  EXPENSES {
    uuid id PK
    text expense_number UK
    uuid location_id FK
    expense_category category
    numeric amount
    date expense_date
    expense_status status
  }

  MAINTENANCE_REQUESTS {
    uuid id PK
    text request_number UK
    uuid location_id FK
    uuid room_id FK
    uuid tenancy_id FK
    uuid reported_by_tenant_id FK
    maintenance_priority priority
    maintenance_status status
    numeric cost
  }

  NOTIFICATIONS {
    uuid id PK
    uuid user_id FK
    uuid location_id FK
    notification_type type
    text title_km
    text title_en
    boolean is_read
  }

  SETTINGS {
    text key PK
    jsonb value
    text description
  }

  AUDIT_LOGS {
    bigint id PK
    uuid actor_id FK
    text action
    text entity_type
    text entity_id
    jsonb old_data
    jsonb new_data
  }
```

---

## Table dictionary

| Table | Purpose | Key rules |
| --- | --- | --- |
| `profiles` | Application identity and role | 1:1 with `auth.users`; tenant role requires `tenant_id`; staff `location_id` may be null (all locations) |
| `locations` | A rental property/building | Unique lowercase code; soft state `active` / `inactive` |
| `rooms` | Rentable unit | Unique `(location_id, room_number)`; status drives occupancy |
| `tenants` | Person or household | Unique code; optional email/ID/emergency contact |
| `tenancies` | Contract linking tenant and room | Partial unique indexes: one active per room and per tenant |
| `meters` | Electricity/water meter | Unique meter number; one active meter per room+utility |
| `utility_rates` | Effective-dated price per utility | No overlapping periods per location+utility (trigger) |
| `meter_readings` | Monthly meter snapshot | Unique `(meter_id, period_start)` among non-void rows; `consumption` generated; `amount` trigger-set |
| `invoices` | Billing document | Unique number; unique `(tenancy_id, billing_period)` among non-void rows; totals generated; immutable after finalization |
| `invoice_items` | Printed breakdown / source of truth | Roll up to invoice category totals while draft; locked after finalization |
| `payments` | Money received | Unique number; amount > 0; immutable except void, and void requires no allocations |
| `payment_allocations` | Payment ↔ invoice ledger | Unique pair; total ≤ payment amount; allocation ≤ invoice balance; immutable |
| `expenses` | Operating costs | Unique number; location nullable for company-wide costs; void keeps history |
| `maintenance_requests` | Work orders | Number assigned automatically; priority/status enums; optional assignee |
| `notifications` | In-app alerts | Per-user or broadcast (null user, optional location); read timestamp consistency |
| `settings` | Application configuration | JSONB key/value; keys match `[a-z][a-z0-9_.]`; admin write |
| `audit_logs` | Immutable financial audit trail | Append-only via security-definer trigger; admin read only |

---

## Money and status rules

### Invoice total

`total_amount` is a **stored generated column**:

```text
total_amount =
    rent_amount
  + electricity_amount
  + water_amount
  + other_charges
  + late_fee
  - discount_amount
  + previous_balance
```

`balance_due` is not stored; it is `total_amount - amount_paid` in `v_invoice_ledger`.
This avoids a second source of truth for a value that changes with every payment.

### Invoice status

| Stored status | Meaning |
| --- | --- |
| `draft` | Editable; may have line items; cannot receive payments |
| `finalized` | Posted, unpaid |
| `partially_paid` | At least one allocation, balance remains |
| `paid` | Allocations equal total |
| `void` | Cancelled with reason; zero allocations; immutable |

“Overdue” and “partial” are **display statuses** in `v_invoice_ledger`, derived from dates
and balances. They are not stored, so no nightly job is required to keep them current.

### Payment flow

```text
payments (tenant + location + amount)
        │
        └── payment_allocations (payment_id, invoice_id, amount)
                    │
                    └── trigger recalculates invoices.amount_paid and status
```

A payment can cover several invoices. Allocations are deleted to unapply money; the
invoice reopens automatically. A payment is voided only after its allocations are gone.

### Meter reading flow

```text
meters (room, utility, number)
      │
      └── meter_readings (period, previous, current)
                │
                ├── consumption = current − previous   (generated)
                └── amount      = consumption × rate   (trigger)
```

Readings may be attached to an invoice item through `invoice_items.meter_reading_id`, so a
printed invoice can show the exact readings behind an electricity or water charge.

---

## Enum reference

| Enum | Values |
| --- | --- |
| `user_role` | admin, manager, accountant, viewer, tenant |
| `location_status` | active, inactive |
| `room_type` | standard, large, small, studio, other |
| `room_status` | vacant, occupied, reserved, maintenance, inactive |
| `tenant_status` | active, inactive, blacklisted |
| `tenancy_status` | upcoming, active, ended, cancelled |
| `utility_type` | electricity, water |
| `meter_status` | active, inactive, replaced |
| `meter_allocation` | individual, shared, master |
| `reading_status` | draft, confirmed, void |
| `invoice_status` | draft, finalized, partially_paid, paid, void |
| `invoice_item_type` | rent, electricity, water, other, discount, late_fee, adjustment |
| `payment_method` | cash, aba, acleda, bank_transfer, other |
| `payment_status` | completed, void |
| `expense_category` | utilities, repairs, supplies, salaries, taxes, other |
| `expense_status` | recorded, void |
| `maintenance_priority` | low, medium, high, urgent |
| `maintenance_status` | open, in_progress, resolved, cancelled |
| `notification_type` | missing_reading, invoice_due, invoice_overdue, contract_expiring, payment_received, high_usage, maintenance, system |

---

## Indexes with business meaning

| Index / constraint | Protects |
| --- | --- |
| `tenancies_one_active_per_room_idx` | A room cannot be double-rented |
| `tenancies_one_active_per_tenant_idx` | One active contract per tenant in Phase 1 |
| `meters_active_room_utility_idx` | One active meter per utility per room |
| `meter_readings_meter_period_live_idx` | One live monthly reading per meter; voided rows allow correction |
| `invoices_tenancy_period_live_idx` | One live bill per contract/month; voided rows allow re-issue |
| `utility_rates_period_unique` + overlap trigger | No ambiguous utility price |
| `payment_allocations_unique` | A payment cannot be allocated twice to one invoice |
| `invoices_paid_within_total` | Paid amount cannot exceed total |
| `invoice_items_amount_sign` | Discounts positive; only adjustments may be negative |

---

## Reporting views

| View | Rows | Grain |
| --- | --- | --- |
| `v_room_occupancy` | Rooms | One row per room, current active tenant |
| `v_tenancy_overview` | Tenancies | Tenant, room, location, days to expiry |
| `v_invoice_ledger` | Invoices | Header totals, balance, display status, overdue flag |
| `v_monthly_financials` | Month × location | Billed, collected, outstanding, expenses, net |
| `v_location_snapshot` | Locations | Room counts by status, rent roll, outstanding |
| `v_latest_readings` | Meters | Latest non-void reading |
| `v_expiring_tenancies` | Tenancies | Active contracts ending within 60 days |
| `v_tenant_balances` | Tenants | Lifetime billed/paid/outstanding |
| `v_open_maintenance` | Requests | Open/in-progress with assignee |
| `v_utility_rates_current` | Location × utility | Effective rate today |

All views are `security_invoker = true`; a tenant querying `v_invoice_ledger` sees only
their own rows, and a location-scoped manager sees only their property.

---

## Seed relationship map

`seed.sql` creates:

- 2 locations (`loc-1`, `loc-2`);
- 22 rooms (12 + 10), with 16 occupied, 2 vacant, 2 reserved, 2 maintenance;
- 16 tenants and 16 active tenancies;
- 44 individual meters (electricity + water per room);
- 4 effective-dated utility rates;
- 11 settings.

`seed_demo.sql` adds the 12-month history. See [OPERATIONS.md](OPERATIONS.md) for rebuild
instructions.
