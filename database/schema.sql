-- ============================================================================
-- RRMS — Residential Rental Management System
-- PostgreSQL 15+ / Supabase schema (Phase 1)
--
-- Design goals
--   * Khmer-first data: every human-readable name has km/en columns.
--   * Money is USD numeric(12,2); rates are numeric(12,4).
--   * Documents (invoices, payments, expenses, maintenance) get immutable
--     human-readable numbers from sequences.
--   * Finalized financial records are immutable; corrections are made by
--     voiding and re-issuing, never by editing history.
--   * RLS is enabled on every table. Staff access is scoped by location;
--     tenants can only read their own records.
--   * Views use security_invoker so RLS applies through them.
--
-- Supabase prerequisites: auth schema, auth.users, auth.uid(),
-- roles anon / authenticated / service_role. For local validation run
-- database/local_bootstrap.sql first.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Enumerations
-- ---------------------------------------------------------------------------

create type public.user_role as enum
  ('admin', 'manager', 'accountant', 'viewer', 'tenant');

create type public.location_status as enum ('active', 'inactive');

create type public.room_type as enum ('standard', 'large', 'small', 'studio', 'other');

create type public.room_status as enum
  ('vacant', 'occupied', 'reserved', 'maintenance', 'inactive');

create type public.tenant_status as enum ('active', 'inactive', 'blacklisted');

create type public.tenancy_status as enum ('upcoming', 'active', 'ended', 'cancelled');

create type public.utility_type as enum ('electricity', 'water');

create type public.meter_status as enum ('active', 'inactive', 'replaced');

create type public.meter_allocation as enum ('individual', 'shared', 'master');

create type public.reading_status as enum ('draft', 'confirmed', 'void');

create type public.invoice_status as enum
  ('draft', 'finalized', 'partially_paid', 'paid', 'void');

create type public.invoice_item_type as enum
  ('rent', 'electricity', 'water', 'other', 'discount', 'late_fee', 'adjustment');

create type public.payment_method as enum
  ('cash', 'aba', 'acleda', 'bank_transfer', 'other');

create type public.payment_status as enum ('completed', 'void');

create type public.expense_category as enum
  ('utilities', 'repairs', 'supplies', 'salaries', 'taxes', 'other');

create type public.expense_status as enum ('recorded', 'void');

create type public.maintenance_priority as enum ('low', 'medium', 'high', 'urgent');

create type public.maintenance_status as enum
  ('open', 'in_progress', 'resolved', 'cancelled');

create type public.notification_type as enum
  ('missing_reading', 'invoice_due', 'invoice_overdue', 'contract_expiring',
   'payment_received', 'high_usage', 'maintenance', 'system');

-- ---------------------------------------------------------------------------
-- 2. Reference tables
-- ---------------------------------------------------------------------------

create table public.locations (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name_km           text not null,
  name_en           text not null default '',
  address_km        text not null default '',
  address_en        text not null default '',
  description_km    text not null default '',
  description_en    text not null default '',
  contact_name      text not null default '',
  contact_phone     text not null default '',
  status            public.location_status not null default 'active',
  currency          char(3) not null default 'USD',
  timezone          text not null default 'Asia/Phnom_Penh',
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint locations_code_format check (code ~ '^[a-z0-9][a-z0-9_-]{1,30}$')
);

create table public.tenants (
  id                        uuid primary key default gen_random_uuid(),
  code                      text not null unique,
  name_km                   text not null,
  name_en                   text not null default '',
  phone                     text not null default '',
  email                     text not null default '',
  id_number                 text not null default '',
  address_km                text not null default '',
  address_en                text not null default '',
  emergency_contact_name    text not null default '',
  emergency_contact_phone   text not null default '',
  status                    public.tenant_status not null default 'active',
  notes                     text not null default '',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint tenants_email_format check (
    email = '' or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
);

create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  full_name         text not null default '',
  phone             text not null default '',
  role              public.user_role not null default 'viewer',
  location_id       uuid references public.locations (id) on delete set null,
  tenant_id         uuid references public.tenants (id) on delete set null,
  language          char(2) not null default 'km',
  avatar_url        text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint profiles_language_check check (language in ('km', 'en')),
  constraint profiles_tenant_role_check check (
    (role = 'tenant' and tenant_id is not null)
    or (role <> 'tenant' and tenant_id is null)
  )
);

create unique index profiles_tenant_unique_idx
  on public.profiles (tenant_id)
  where tenant_id is not null;

create table public.rooms (
  id                uuid primary key default gen_random_uuid(),
  location_id       uuid not null references public.locations (id) on delete restrict,
  room_number       text not null,
  floor             integer not null default 1,
  room_type         public.room_type not null default 'standard',
  monthly_rent      numeric(12, 2) not null default 0,
  status            public.room_status not null default 'vacant',
  notes             text not null default '',
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint rooms_rent_nonnegative check (monthly_rent >= 0),
  constraint rooms_number_not_blank check (length(btrim(room_number)) > 0),
  constraint rooms_location_number_unique unique (location_id, room_number)
);

create table public.tenancies (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  room_id           uuid not null references public.rooms (id) on delete restrict,
  location_id       uuid not null references public.locations (id) on delete restrict,
  start_date        date not null,
  end_date          date,
  move_out_date     date,
  monthly_rent      numeric(12, 2) not null,
  deposit_amount    numeric(12, 2) not null default 0,
  deposit_paid      numeric(12, 2) not null default 0,
  status            public.tenancy_status not null default 'active',
  notes             text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint tenancies_rent_nonnegative check (monthly_rent >= 0),
  constraint tenancies_deposit_nonnegative check (
    deposit_amount >= 0 and deposit_paid >= 0 and deposit_paid <= deposit_amount
  ),
  constraint tenancies_dates_ordered check (
    (end_date is null or end_date >= start_date)
    and (move_out_date is null or move_out_date >= start_date)
  )
);

-- A room can only have one active tenancy, and a tenant can only hold one
-- active tenancy at a time in this single-property-manager model.
create unique index tenancies_one_active_per_room_idx
  on public.tenancies (room_id)
  where status = 'active';

create unique index tenancies_one_active_per_tenant_idx
  on public.tenancies (tenant_id)
  where status = 'active';

create table public.meters (
  id                uuid primary key default gen_random_uuid(),
  location_id       uuid not null references public.locations (id) on delete restrict,
  room_id           uuid references public.rooms (id) on delete restrict,
  utility           public.utility_type not null,
  meter_number      text not null unique,
  allocation_method public.meter_allocation not null default 'individual',
  initial_reading   numeric(14, 2) not null default 0,
  installed_on      date,
  status            public.meter_status not null default 'active',
  notes             text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint meters_initial_nonnegative check (initial_reading >= 0),
  constraint meters_room_required check (
    allocation_method <> 'individual' or room_id is not null
  )
);

create unique index meters_active_room_utility_idx
  on public.meters (room_id, utility)
  where room_id is not null and status = 'active';

create table public.utility_rates (
  id                uuid primary key default gen_random_uuid(),
  location_id       uuid not null references public.locations (id) on delete restrict,
  utility           public.utility_type not null,
  rate              numeric(12, 4) not null,
  effective_from    date not null,
  effective_to      date,
  notes             text not null default '',
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint utility_rates_rate_nonnegative check (rate >= 0),
  constraint utility_rates_dates_ordered check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint utility_rates_period_unique unique (location_id, utility, effective_from)
);

create table public.meter_readings (
  id                uuid primary key default gen_random_uuid(),
  meter_id          uuid not null references public.meters (id) on delete restrict,
  location_id       uuid not null references public.locations (id) on delete restrict,
  room_id           uuid references public.rooms (id) on delete restrict,
  tenancy_id        uuid references public.tenancies (id) on delete set null,
  utility           public.utility_type not null,
  period_start      date not null,
  reading_date      date not null,
  previous_reading  numeric(14, 2) not null,
  current_reading   numeric(14, 2) not null,
  consumption       numeric(14, 2) generated always as
                      (current_reading - previous_reading) stored,
  rate              numeric(12, 4) not null,
  amount            numeric(12, 2) not null default 0,
  status            public.reading_status not null default 'draft',
  notes             text not null default '',
  recorded_by       uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint meter_readings_period_first_day check (extract(day from period_start) = 1),
  constraint meter_readings_values_ordered check (current_reading >= previous_reading),
  constraint meter_readings_values_nonnegative check (previous_reading >= 0),
  constraint meter_readings_rate_nonnegative check (rate >= 0),
  constraint meter_readings_amount_nonnegative check (amount >= 0)
);

-- A meter can only have one live reading per month. Voided rows remain for
-- history and do not block a corrected re-entry.
create unique index meter_readings_meter_period_live_idx
  on public.meter_readings (meter_id, period_start)
  where status <> 'void';

-- ---------------------------------------------------------------------------
-- 3. Document number sequences
-- ---------------------------------------------------------------------------

create sequence public.invoice_number_seq start with 1 increment by 1;
create sequence public.payment_number_seq start with 1 increment by 1;
create sequence public.expense_number_seq start with 1 increment by 1;
create sequence public.maintenance_number_seq start with 1 increment by 1;

-- ---------------------------------------------------------------------------
-- 4. Billing, money and operations
-- ---------------------------------------------------------------------------

create table public.invoices (
  id                uuid primary key default gen_random_uuid(),
  invoice_number    text unique,
  location_id       uuid not null references public.locations (id) on delete restrict,
  room_id           uuid not null references public.rooms (id) on delete restrict,
  tenancy_id        uuid not null references public.tenancies (id) on delete restrict,
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  billing_period    date not null,
  issue_date        date not null default current_date,
  due_date          date not null,
  rent_amount       numeric(12, 2) not null default 0,
  electricity_amount numeric(12, 2) not null default 0,
  water_amount      numeric(12, 2) not null default 0,
  other_charges     numeric(12, 2) not null default 0,
  discount_amount   numeric(12, 2) not null default 0,
  late_fee          numeric(12, 2) not null default 0,
  previous_balance  numeric(12, 2) not null default 0,
  total_amount      numeric(12, 2) generated always as (
                      rent_amount + electricity_amount + water_amount
                      + other_charges + late_fee - discount_amount
                      + previous_balance
                    ) stored,
  amount_paid       numeric(12, 2) not null default 0,
  currency          char(3) not null default 'USD',
  status            public.invoice_status not null default 'draft',
  notes             text not null default '',
  finalized_at      timestamptz,
  voided_at         timestamptz,
  void_reason       text,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint invoices_period_first_day check (extract(day from billing_period) = 1),
  constraint invoices_dates_ordered check (due_date >= issue_date),
  constraint invoices_amounts_nonnegative check (
    rent_amount >= 0 and electricity_amount >= 0 and water_amount >= 0
    and other_charges >= 0 and discount_amount >= 0 and late_fee >= 0
    and previous_balance >= 0 and amount_paid >= 0
  ),
  constraint invoices_total_nonnegative check (total_amount >= 0),
  constraint invoices_paid_within_total check (amount_paid <= total_amount)
);

-- One live invoice per tenancy per billing period. A voided invoice keeps its
-- number and history but allows a corrected document to be issued.
create unique index invoices_tenancy_period_live_idx
  on public.invoices (tenancy_id, billing_period)
  where status <> 'void';

create table public.invoice_items (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references public.invoices (id) on delete cascade,
  item_type         public.invoice_item_type not null,
  description_km    text not null default '',
  description_en    text not null default '',
  quantity          numeric(12, 2) not null default 1,
  unit_price        numeric(12, 2) not null default 0,
  amount            numeric(12, 2) not null,
  meter_reading_id  uuid references public.meter_readings (id) on delete restrict,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  constraint invoice_items_amount_sign check (
    (item_type = 'adjustment') or amount >= 0
  ),
  constraint invoice_items_unit_price_nonnegative check (unit_price >= 0),
  constraint invoice_items_quantity_positive check (quantity > 0)
);

create table public.payments (
  id                uuid primary key default gen_random_uuid(),
  payment_number    text unique,
  location_id       uuid not null references public.locations (id) on delete restrict,
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  payment_date      date not null default current_date,
  amount            numeric(12, 2) not null,
  currency          char(3) not null default 'USD',
  method            public.payment_method not null default 'cash',
  reference         text not null default '',
  notes             text not null default '',
  status            public.payment_status not null default 'completed',
  received_by       uuid references public.profiles (id) on delete set null,
  voided_at         timestamptz,
  void_reason       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint payments_amount_positive check (amount > 0)
);

create table public.payment_allocations (
  id                uuid primary key default gen_random_uuid(),
  payment_id        uuid not null references public.payments (id) on delete restrict,
  invoice_id        uuid not null references public.invoices (id) on delete restrict,
  amount            numeric(12, 2) not null,
  created_at        timestamptz not null default now(),
  constraint payment_allocations_amount_positive check (amount > 0),
  constraint payment_allocations_unique unique (payment_id, invoice_id)
);

create table public.expenses (
  id                uuid primary key default gen_random_uuid(),
  expense_number    text unique,
  location_id       uuid references public.locations (id) on delete restrict,
  category          public.expense_category not null default 'other',
  description       text not null,
  amount            numeric(12, 2) not null,
  currency          char(3) not null default 'USD',
  expense_date      date not null default current_date,
  vendor            text not null default '',
  receipt_url       text,
  status            public.expense_status not null default 'recorded',
  notes             text not null default '',
  created_by        uuid references public.profiles (id) on delete set null,
  voided_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint expenses_amount_positive check (amount > 0)
);

create table public.maintenance_requests (
  id                    uuid primary key default gen_random_uuid(),
  request_number        text unique,
  location_id           uuid not null references public.locations (id) on delete restrict,
  room_id               uuid references public.rooms (id) on delete set null,
  tenancy_id            uuid references public.tenancies (id) on delete set null,
  reported_by_tenant_id uuid references public.tenants (id) on delete set null,
  title                 text not null,
  description           text not null default '',
  priority              public.maintenance_priority not null default 'medium',
  status                public.maintenance_status not null default 'open',
  reported_at           timestamptz not null default now(),
  scheduled_for         timestamptz,
  resolved_at           timestamptz,
  cost                  numeric(12, 2) not null default 0,
  assigned_to           uuid references public.profiles (id) on delete set null,
  notes                 text not null default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint maintenance_cost_nonnegative check (cost >= 0)
);

create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references public.profiles (id) on delete cascade,
  location_id       uuid references public.locations (id) on delete cascade,
  type              public.notification_type not null,
  title_km          text not null,
  title_en          text not null default '',
  body_km           text not null default '',
  body_en           text not null default '',
  link              text,
  entity_type       text,
  entity_id         text,
  is_read           boolean not null default false,
  read_at           timestamptz,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz,
  constraint notifications_read_consistency check (
    (is_read = false and read_at is null)
    or (is_read = true and read_at is not null)
  )
);

create table public.settings (
  key               text primary key,
  value             jsonb not null,
  description       text not null default '',
  updated_by        uuid references public.profiles (id) on delete set null,
  updated_at        timestamptz not null default now(),
  constraint settings_key_format check (key ~ '^[a-z][a-z0-9_.]{1,63}$')
);

create table public.audit_logs (
  id                bigint generated always as identity primary key,
  actor_id          uuid references public.profiles (id) on delete set null,
  action            text not null,
  entity_type       text not null,
  entity_id         text not null,
  old_data          jsonb,
  new_data          jsonb,
  ip_address        inet,
  user_agent        text,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. Indexes for the dashboard and operational queries
-- ---------------------------------------------------------------------------

create index invoices_period_location_idx
  on public.invoices (billing_period desc, location_id, status);
create index invoices_tenant_idx on public.invoices (tenant_id, billing_period desc);
create index invoices_room_idx on public.invoices (room_id, billing_period desc);
create index invoices_outstanding_idx
  on public.invoices (due_date)
  where status in ('finalized', 'partially_paid');

create index invoice_items_invoice_idx on public.invoice_items (invoice_id, sort_order);
create index invoice_items_reading_idx on public.invoice_items (meter_reading_id)
  where meter_reading_id is not null;

create index payments_location_date_idx
  on public.payments (location_id, payment_date desc);
create index payments_tenant_date_idx
  on public.payments (tenant_id, payment_date desc);
create index allocations_invoice_idx on public.payment_allocations (invoice_id);
create index allocations_payment_idx on public.payment_allocations (payment_id);

create index expenses_location_date_idx
  on public.expenses (location_id, expense_date desc);
create index expenses_date_idx on public.expenses (expense_date desc);

create index readings_period_idx
  on public.meter_readings (period_start desc, location_id);
create index readings_room_idx
  on public.meter_readings (room_id, utility, period_start desc);
create index readings_status_idx on public.meter_readings (status);

create index tenancies_status_end_idx
  on public.tenancies (status, end_date)
  where status = 'active';
create index tenancies_tenant_idx on public.tenancies (tenant_id);

create index maintenance_status_idx
  on public.maintenance_requests (status, priority, reported_at desc);
create index maintenance_location_idx
  on public.maintenance_requests (location_id, status);

create index notifications_user_unread_idx
  on public.notifications (user_id, is_read, created_at desc);
create index notifications_location_idx
  on public.notifications (location_id, created_at desc);

create index audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx
  on public.audit_logs (actor_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 6. Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.rrms_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active
$$;

create or replace function public.rrms_location()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.location_id
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active
$$;

create or replace function public.rrms_tenant()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.tenant_id
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active
    and p.role = 'tenant'
$$;

create or replace function public.rrms_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.rrms_role() in
    ('admin', 'manager', 'accountant', 'viewer'), false)
$$;

create or replace function public.rrms_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.rrms_role() in ('admin', 'manager'), false)
$$;

create or replace function public.rrms_can_bill()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.rrms_role() in
    ('admin', 'manager', 'accountant'), false)
$$;

create or replace function public.rrms_can_view_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when public.rrms_role() = 'admin' then true
    when public.rrms_is_staff() then
      public.rrms_location() is null
      or public.rrms_location() = p_location_id
    else false
  end
$$;

-- ---------------------------------------------------------------------------
-- 7. Profiles
-- ---------------------------------------------------------------------------

create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- SQL migrations, seeds and service_role operations have no auth.uid().
  if auth.uid() is null then
    return new;
  end if;
  if public.rrms_role() = 'admin' then
    return new;
  end if;
  if new.role <> old.role
     or new.is_active <> old.is_active
     or new.location_id is distinct from old.location_id
     or new.tenant_id is distinct from old.tenant_id then
    raise exception 'Only administrators can change a profile role, scope or active status'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Provision a profile when Supabase Auth creates a user. Role changes are an
-- explicit admin action; new accounts start read-only.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, phone, role, language)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    'viewer',
    'km'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 8. Document numbers
-- ---------------------------------------------------------------------------

create or replace function public.assign_invoice_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.invoice_number is null then
    new.invoice_number := 'INV-' || to_char(coalesce(new.issue_date, current_date), 'YYYY')
      || '-' || lpad(nextval('public.invoice_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create or replace function public.assign_payment_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.payment_number is null then
    new.payment_number := 'PAY-' || to_char(coalesce(new.payment_date, current_date), 'YYYY')
      || '-' || lpad(nextval('public.payment_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create or replace function public.assign_expense_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.expense_number is null then
    new.expense_number := 'EXP-' || to_char(coalesce(new.expense_date, current_date), 'YYYY')
      || '-' || lpad(nextval('public.expense_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create or replace function public.assign_maintenance_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.request_number is null then
    new.request_number := 'MNT-' || to_char(current_date, 'YYYY')
      || '-' || lpad(nextval('public.maintenance_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger invoices_assign_number
  before insert on public.invoices
  for each row execute function public.assign_invoice_number();
create trigger payments_assign_number
  before insert on public.payments
  for each row execute function public.assign_payment_number();
create trigger expenses_assign_number
  before insert on public.expenses
  for each row execute function public.assign_expense_number();
create trigger maintenance_assign_number
  before insert on public.maintenance_requests
  for each row execute function public.assign_maintenance_number();

-- ---------------------------------------------------------------------------
-- 9. Meter readings
-- ---------------------------------------------------------------------------

create or replace function public.validate_meter_reading()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_meter public.meters%rowtype;
begin
  select * into v_meter from public.meters where id = new.meter_id;
  if not found then
    raise exception 'Meter % does not exist', new.meter_id;
  end if;

  if v_meter.status <> 'active' then
    raise exception 'Meter % is not active', v_meter.meter_number;
  end if;

  new.utility := v_meter.utility;
  new.location_id := v_meter.location_id;

  if v_meter.room_id is not null then
    if new.room_id is not null and new.room_id <> v_meter.room_id then
      raise exception 'Reading room does not match meter room';
    end if;
    new.room_id := v_meter.room_id;
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'void' then
      raise exception 'Void readings are immutable';
    end if;
    if old.status = 'confirmed'
       and (new.current_reading <> old.current_reading
            or new.previous_reading <> old.previous_reading
            or new.rate <> old.rate
            or new.meter_id <> old.meter_id
            or new.period_start <> old.period_start) then
      raise exception 'Confirmed readings cannot be edited; void and re-enter';
    end if;
  end if;

  new.amount := round(
    ((new.current_reading - new.previous_reading) * new.rate)::numeric, 2
  );
  return new;
end;
$$;

create or replace function public.prevent_confirmed_reading_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status <> 'draft' then
    raise exception 'Only draft readings can be deleted';
  end if;
  return old;
end;
$$;

create trigger meter_readings_validate
  before insert or update on public.meter_readings
  for each row execute function public.validate_meter_reading();

create trigger meter_readings_prevent_delete
  before delete on public.meter_readings
  for each row execute function public.prevent_confirmed_reading_delete();

create trigger meter_readings_set_updated_at
  before update on public.meter_readings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 10. Utility rate overlap protection
-- ---------------------------------------------------------------------------

create or replace function public.check_utility_rate_overlap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.utility_rates r
    where r.location_id = new.location_id
      and r.utility = new.utility
      and r.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and daterange(r.effective_from, coalesce(r.effective_to, 'infinity'::date), '[]')
          && daterange(new.effective_from, coalesce(new.effective_to, 'infinity'::date), '[]')
  ) then
    raise exception 'Utility rates may not overlap for the same location and utility';
  end if;
  return new;
end;
$$;

create trigger utility_rates_check_overlap
  before insert or update on public.utility_rates
  for each row execute function public.check_utility_rate_overlap();

-- ---------------------------------------------------------------------------
-- 11. Invoice line-item totals and lifecycle
-- ---------------------------------------------------------------------------

create or replace function public.recalc_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.invoice_status;
begin
  select status into v_status
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice % does not exist', p_invoice_id;
  end if;

  if v_status <> 'draft' then
    raise exception 'Invoice line items are locked after finalization'
      using errcode = '55000';
  end if;

  update public.invoices i
  set
    rent_amount = coalesce((
      select sum(ii.amount) from public.invoice_items ii
      where ii.invoice_id = p_invoice_id and ii.item_type = 'rent'
    ), 0),
    electricity_amount = coalesce((
      select sum(ii.amount) from public.invoice_items ii
      where ii.invoice_id = p_invoice_id and ii.item_type = 'electricity'
    ), 0),
    water_amount = coalesce((
      select sum(ii.amount) from public.invoice_items ii
      where ii.invoice_id = p_invoice_id and ii.item_type = 'water'
    ), 0),
    other_charges = coalesce((
      select sum(ii.amount) from public.invoice_items ii
      where ii.invoice_id = p_invoice_id
        and ii.item_type in ('other', 'adjustment')
    ), 0),
    discount_amount = coalesce((
      select sum(ii.amount) from public.invoice_items ii
      where ii.invoice_id = p_invoice_id and ii.item_type = 'discount'
    ), 0),
    late_fee = coalesce((
      select sum(ii.amount) from public.invoice_items ii
      where ii.invoice_id = p_invoice_id and ii.item_type = 'late_fee'
    ), 0)
  where i.id = p_invoice_id;
end;
$$;

create or replace function public.sync_invoice_item_totals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then
    raise exception 'An invoice item cannot be moved to another invoice';
  end if;

  perform public.recalc_invoice_totals(
    case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end
  );
  return null;
end;
$$;

create trigger invoice_items_sync_totals
  after insert or update or delete on public.invoice_items
  for each row execute function public.sync_invoice_item_totals();

create or replace function public.guard_invoice_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'Invoices must be created as drafts, then finalized';
    end if;
    if new.amount_paid <> 0 then
      raise exception 'A new invoice cannot already have payments';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only draft invoices can be deleted';
    end if;
    return old;
  end if;

  if old.status = 'void' then
    raise exception 'Void invoices are immutable';
  end if;

  if new.status = 'void' then
    if old.status = 'void' then
      raise exception 'Invoice is already void';
    end if;
    if new.amount_paid <> 0 then
      raise exception 'Remove payment allocations before voiding an invoice';
    end if;
    if btrim(coalesce(new.void_reason, '')) = '' then
      raise exception 'A void reason is required';
    end if;
    new.voided_at := coalesce(new.voided_at, now());
    new.void_reason := btrim(new.void_reason);
    return new;
  end if;

  -- Finalized financial records may only change in amount_paid, notes and
  -- lifecycle status. Everything that defines the document is immutable.
  if old.status <> 'draft' then
    if new.location_id <> old.location_id
       or new.room_id <> old.room_id
       or new.tenancy_id <> old.tenancy_id
       or new.tenant_id <> old.tenant_id
       or new.billing_period <> old.billing_period
       or new.issue_date <> old.issue_date
       or new.due_date <> old.due_date
       or new.rent_amount <> old.rent_amount
       or new.electricity_amount <> old.electricity_amount
       or new.water_amount <> old.water_amount
       or new.other_charges <> old.other_charges
       or new.discount_amount <> old.discount_amount
       or new.late_fee <> old.late_fee
       or new.previous_balance <> old.previous_balance
       or new.currency <> old.currency
       or new.invoice_number is distinct from old.invoice_number
       or new.finalized_at is distinct from old.finalized_at then
      raise exception 'Finalized invoice fields are immutable'
        using errcode = '55000';
    end if;

    if new.amount_paid <> old.amount_paid
       and coalesce(current_setting('rrms.allocation_write', true), 'off') <> 'on' then
      raise exception 'Invoice payments change only through payment allocations'
        using errcode = '55000';
    end if;

    if new.amount_paid < 0 or new.amount_paid > old.total_amount then
      raise exception 'Paid amount must be between zero and the invoice total';
    end if;

    new.status := case
      when new.amount_paid <= 0 then 'finalized'::public.invoice_status
      when new.amount_paid >= old.total_amount then 'paid'::public.invoice_status
      else 'partially_paid'::public.invoice_status
    end;
    return new;
  end if;

  -- Draft invoice ------------------------------------------------
  if new.status = 'draft' then
    if new.amount_paid <> 0 then
      raise exception 'Draft invoices cannot have payments';
    end if;
    return new;
  end if;

  if new.status <> 'finalized' then
    raise exception 'Draft invoices can only be finalized or voided';
  end if;

  if not exists (select 1 from public.invoice_items where invoice_id = old.id) then
    raise exception 'Add at least one line item before finalizing';
  end if;
  if old.total_amount <= 0 then
    raise exception 'Invoice total must be greater than zero';
  end if;
  if new.amount_paid <> 0 then
    raise exception 'Draft invoices cannot have payments';
  end if;

  new.finalized_at := coalesce(new.finalized_at, now());
  new.status := 'finalized';
  return new;
end;
$$;

create trigger invoices_guard_write
  before insert or update or delete on public.invoices
  for each row execute function public.guard_invoice_write();

-- ---------------------------------------------------------------------------
-- 12. Payments and allocations
-- ---------------------------------------------------------------------------

create or replace function public.guard_payment_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'completed' then
      raise exception 'New payments must be completed';
    end if;
    new.received_by := coalesce(new.received_by, auth.uid());
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Payments are never deleted; void them instead';
  end if;

  if old.status = 'void' then
    raise exception 'Void payments are immutable';
  end if;

  if new.payment_number is distinct from old.payment_number
     or new.location_id <> old.location_id
     or new.tenant_id <> old.tenant_id
     or new.payment_date <> old.payment_date
     or new.amount <> old.amount
     or new.currency <> old.currency
     or new.method <> old.method
     or new.received_by is distinct from old.received_by then
    raise exception 'Payment financial fields are immutable'
      using errcode = '55000';
  end if;

  if new.status = 'void' then
    if old.status = 'void' then
      raise exception 'Payment is already void';
    end if;
    if exists (select 1 from public.payment_allocations where payment_id = old.id) then
      raise exception 'Remove allocations before voiding a payment';
    end if;
    if btrim(coalesce(new.void_reason, '')) = '' then
      raise exception 'A void reason is required';
    end if;
    new.voided_at := coalesce(new.voided_at, now());
    new.void_reason := btrim(new.void_reason);
    return new;
  end if;

  if new.status <> old.status then
    raise exception 'Unsupported payment status change';
  end if;

  return new;
end;
$$;

create trigger payments_guard_write
  before insert or update or delete on public.payments
  for each row execute function public.guard_payment_write();

create or replace function public.validate_payment_allocation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_invoice public.invoices%rowtype;
  v_allocated numeric(12, 2);
begin
  select * into v_payment from public.payments where id = new.payment_id;
  if not found then
    raise exception 'Payment % does not exist', new.payment_id;
  end if;
  if v_payment.status <> 'completed' then
    raise exception 'Cannot allocate a void payment';
  end if;
  if v_payment.currency <> 'USD' then
    raise exception 'Only USD allocations are supported in Phase 1';
  end if;

  select * into v_invoice from public.invoices where id = new.invoice_id;
  if not found then
    raise exception 'Invoice % does not exist', new.invoice_id;
  end if;
  if v_invoice.status not in ('finalized', 'partially_paid') then
    raise exception 'Allocations require a finalized, unpaid or partially paid invoice';
  end if;
  if v_invoice.currency <> v_payment.currency then
    raise exception 'Payment and invoice currencies must match';
  end if;
  if v_invoice.tenant_id <> v_payment.tenant_id
     or v_invoice.location_id <> v_payment.location_id then
    raise exception 'Payment tenant/location does not match the invoice';
  end if;
  if new.amount > (v_invoice.total_amount - v_invoice.amount_paid) then
    raise exception 'Allocation exceeds the invoice balance';
  end if;

  select coalesce(sum(amount), 0) into v_allocated
  from public.payment_allocations
  where payment_id = new.payment_id;

  if v_allocated + new.amount > v_payment.amount then
    raise exception 'Total allocations exceed the payment amount';
  end if;

  return new;
end;
$$;

create or replace function public.apply_payment_allocation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('rrms.allocation_write', 'on', true);
  update public.invoices
  set amount_paid = amount_paid + new.amount
  where id = new.invoice_id;
  perform set_config('rrms.allocation_write', 'off', true);
  return null;
end;
$$;

create or replace function public.reverse_payment_allocation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('rrms.allocation_write', 'on', true);
  update public.invoices
  set amount_paid = greatest(amount_paid - old.amount, 0)
  where id = old.invoice_id;
  perform set_config('rrms.allocation_write', 'off', true);
  return old;
end;
$$;

create or replace function public.prevent_allocation_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Allocations are immutable; delete and re-create the payment instead';
end;
$$;

create trigger payment_allocations_validate
  before insert on public.payment_allocations
  for each row execute function public.validate_payment_allocation();

create trigger payment_allocations_apply
  after insert on public.payment_allocations
  for each row execute function public.apply_payment_allocation();

create trigger payment_allocations_reverse
  before delete on public.payment_allocations
  for each row execute function public.reverse_payment_allocation();

create trigger payment_allocations_prevent_update
  before update on public.payment_allocations
  for each row execute function public.prevent_allocation_update();

-- ---------------------------------------------------------------------------
-- 13. Audit trail
-- ---------------------------------------------------------------------------

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.audit_logs
      (actor_id, action, entity_type, entity_id, old_data, new_data)
    values
      (auth.uid(), 'delete', tg_table_name, old.id::text, to_jsonb(old), null);
    return old;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_logs
      (actor_id, action, entity_type, entity_id, old_data, new_data)
    values
      (auth.uid(), 'update', tg_table_name, new.id::text, to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.audit_logs
      (actor_id, action, entity_type, entity_id, old_data, new_data)
    values
      (auth.uid(), 'insert', tg_table_name, new.id::text, null, to_jsonb(new));
    return new;
  end if;
end;
$$;

create trigger invoices_audit
  after insert or update or delete on public.invoices
  for each row execute function public.audit_row_change();

create trigger payments_audit
  after insert or update or delete on public.payments
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- 14. updated_at triggers
-- ---------------------------------------------------------------------------

create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();
create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();
create trigger rooms_set_updated_at
  before update on public.rooms
  for each row execute function public.set_updated_at();
create trigger tenancies_set_updated_at
  before update on public.tenancies
  for each row execute function public.set_updated_at();
create trigger meters_set_updated_at
  before update on public.meters
  for each row execute function public.set_updated_at();
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();
create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();
create trigger maintenance_set_updated_at
  before update on public.maintenance_requests
  for each row execute function public.set_updated_at();
create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 15. RLS helper functions
-- ---------------------------------------------------------------------------

create or replace function public.rrms_tenant_visible(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when public.rrms_role() = 'admin' then true
    when public.rrms_is_staff() then
      public.rrms_location() is null
      or exists (
        select 1 from public.tenancies t
        where t.tenant_id = p_tenant_id
          and t.location_id = public.rrms_location()
      )
    else false
  end
$$;

create or replace function public.rrms_tenant_has_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tenancies t
    where t.tenant_id = public.rrms_tenant()
      and t.location_id = p_location_id
      and t.status in ('active', 'upcoming')
  )
$$;

create or replace function public.rrms_tenant_has_room(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tenancies t
    where t.tenant_id = public.rrms_tenant()
      and t.room_id = p_room_id
      and t.status in ('active', 'upcoming')
  )
$$;

-- ---------------------------------------------------------------------------
-- 16. Reporting views (security_invoker so RLS applies to the caller)
-- ---------------------------------------------------------------------------

create view public.v_room_occupancy
with (security_invoker = true)
as
select
  r.id,
  r.location_id,
  l.name_km as location_name_km,
  l.name_en as location_name_en,
  r.room_number,
  r.floor,
  r.room_type,
  r.monthly_rent,
  r.status as room_status,
  t.id as tenancy_id,
  t.tenant_id,
  tn.name_km as tenant_name_km,
  tn.name_en as tenant_name_en,
  tn.phone as tenant_phone,
  t.start_date,
  t.end_date,
  t.monthly_rent as tenancy_rent
from public.rooms r
join public.locations l on l.id = r.location_id
left join public.tenancies t
  on t.room_id = r.id and t.status = 'active'
left join public.tenants tn on tn.id = t.tenant_id;

create view public.v_tenancy_overview
with (security_invoker = true)
as
select
  t.id,
  t.code,
  t.status,
  t.start_date,
  t.end_date,
  t.move_out_date,
  t.monthly_rent,
  t.deposit_amount,
  t.deposit_paid,
  t.tenant_id,
  tn.name_km as tenant_name_km,
  tn.name_en as tenant_name_en,
  tn.phone as tenant_phone,
  t.room_id,
  r.room_number,
  t.location_id,
  l.name_km as location_name_km,
  l.name_en as location_name_en,
  case when t.end_date is null then null else t.end_date - current_date end as days_until_end
from public.tenancies t
join public.tenants tn on tn.id = t.tenant_id
join public.rooms r on r.id = t.room_id
join public.locations l on l.id = t.location_id;

create view public.v_invoice_ledger
with (security_invoker = true)
as
select
  i.id,
  i.invoice_number,
  i.billing_period,
  to_char(i.billing_period, 'YYYY-MM') as billing_month,
  i.location_id,
  l.name_km as location_name_km,
  l.name_en as location_name_en,
  i.room_id,
  r.room_number,
  i.tenant_id,
  tn.name_km as tenant_name_km,
  tn.name_en as tenant_name_en,
  tn.phone as tenant_phone,
  i.tenancy_id,
  i.issue_date,
  i.due_date,
  i.rent_amount,
  i.electricity_amount,
  i.water_amount,
  i.other_charges,
  i.discount_amount,
  i.late_fee,
  i.previous_balance,
  i.total_amount,
  i.amount_paid,
  i.total_amount - i.amount_paid as balance_due,
  i.currency,
  i.status,
  case
    when i.status = 'draft' then 'draft'
    when i.status = 'void' then 'void'
    when i.amount_paid >= i.total_amount then 'paid'
    when i.amount_paid > 0 then 'partial'
    when i.due_date < current_date then 'overdue'
    else 'unpaid'
  end as display_status,
  (
    i.status not in ('draft', 'void')
    and i.amount_paid < i.total_amount
    and i.due_date < current_date
  ) as is_overdue
from public.invoices i
join public.locations l on l.id = i.location_id
join public.rooms r on r.id = i.room_id
join public.tenants tn on tn.id = i.tenant_id;

create view public.v_monthly_financials
with (security_invoker = true)
as
with months as (
  select distinct
    date_trunc('month', i.billing_period)::date as month,
    i.location_id
  from public.invoices i
  where i.status <> 'void'
  union
  select distinct
    date_trunc('month', e.expense_date)::date as month,
    e.location_id
  from public.expenses e
  where e.status = 'recorded'
)
select
  m.month,
  to_char(m.month, 'YYYY-MM') as month_key,
  m.location_id,
  l.name_km as location_name_km,
  l.name_en as location_name_en,
  coalesce(inv.billed, 0) as billed,
  coalesce(inv.collected, 0) as collected,
  coalesce(inv.outstanding, 0) as outstanding,
  coalesce(inv.invoice_count, 0) as invoice_count,
  coalesce(exp.expenses, 0) as expenses,
  coalesce(inv.collected, 0) - coalesce(exp.expenses, 0) as net
from months m
left join public.locations l on l.id = m.location_id
left join lateral (
  select
    sum(i.total_amount) as billed,
    sum(i.amount_paid) as collected,
    sum(i.total_amount - i.amount_paid) as outstanding,
    count(*) as invoice_count
  from public.invoices i
  where date_trunc('month', i.billing_period)::date = m.month
    and i.location_id is not distinct from m.location_id
    and i.status in ('finalized', 'partially_paid', 'paid')
) inv on true
left join lateral (
  select sum(e.amount) as expenses
  from public.expenses e
  where date_trunc('month', e.expense_date)::date = m.month
    and e.location_id is not distinct from m.location_id
    and e.status = 'recorded'
) exp on true;

create view public.v_location_snapshot
with (security_invoker = true)
as
select
  l.id,
  l.code,
  l.name_km,
  l.name_en,
  l.status,
  count(r.id) as total_rooms,
  count(r.id) filter (where r.status = 'occupied') as occupied_rooms,
  count(r.id) filter (where r.status = 'vacant') as vacant_rooms,
  count(r.id) filter (where r.status = 'reserved') as reserved_rooms,
  count(r.id) filter (where r.status = 'maintenance') as maintenance_rooms,
  coalesce(sum(r.monthly_rent) filter (where r.status = 'occupied'), 0) as rent_roll,
  coalesce((
    select sum(i.total_amount - i.amount_paid)
    from public.invoices i
    where i.location_id = l.id
      and i.status in ('finalized', 'partially_paid')
  ), 0) as outstanding
from public.locations l
left join public.rooms r on r.location_id = l.id
group by l.id;

create view public.v_latest_readings
with (security_invoker = true)
as
select distinct on (mr.meter_id)
  mr.id,
  mr.meter_id,
  m.meter_number,
  mr.utility,
  mr.location_id,
  mr.room_id,
  r.room_number,
  mr.period_start,
  mr.reading_date,
  mr.previous_reading,
  mr.current_reading,
  mr.consumption,
  mr.rate,
  mr.amount,
  mr.status
from public.meter_readings mr
join public.meters m on m.id = mr.meter_id
left join public.rooms r on r.id = mr.room_id
where mr.status <> 'void'
order by mr.meter_id, mr.period_start desc, mr.created_at desc;

create view public.v_expiring_tenancies
with (security_invoker = true)
as
select
  t.id,
  t.code,
  t.tenant_id,
  tn.name_km as tenant_name_km,
  tn.name_en as tenant_name_en,
  tn.phone as tenant_phone,
  t.room_id,
  r.room_number,
  t.location_id,
  l.name_km as location_name_km,
  t.end_date,
  t.end_date - current_date as days_until_end,
  t.monthly_rent
from public.tenancies t
join public.tenants tn on tn.id = t.tenant_id
join public.rooms r on r.id = t.room_id
join public.locations l on l.id = t.location_id
where t.status = 'active'
  and t.end_date is not null
  and t.end_date between current_date and current_date + 60;

create view public.v_tenant_balances
with (security_invoker = true)
as
select
  t.id,
  t.name_km,
  t.name_en,
  t.phone,
  coalesce(sum(i.total_amount) filter (
    where i.status in ('finalized', 'partially_paid', 'paid')
  ), 0) as total_billed,
  coalesce(sum(i.amount_paid) filter (
    where i.status in ('finalized', 'partially_paid', 'paid')
  ), 0) as total_paid,
  coalesce(sum(i.total_amount - i.amount_paid) filter (
    where i.status in ('finalized', 'partially_paid')
  ), 0) as balance_due
from public.tenants t
left join public.invoices i on i.tenant_id = t.id
group by t.id;

create view public.v_open_maintenance
with (security_invoker = true)
as
select
  m.id,
  m.request_number,
  m.location_id,
  l.name_km as location_name_km,
  m.room_id,
  r.room_number,
  m.title,
  m.description,
  m.priority,
  m.status,
  m.reported_at,
  m.scheduled_for,
  m.assigned_to,
  p.full_name as assigned_to_name
from public.maintenance_requests m
join public.locations l on l.id = m.location_id
left join public.rooms r on r.id = m.room_id
left join public.profiles p on p.id = m.assigned_to
where m.status in ('open', 'in_progress');

create view public.v_utility_rates_current
with (security_invoker = true)
as
select distinct on (r.location_id, r.utility)
  r.id,
  r.location_id,
  r.utility,
  r.rate,
  r.effective_from,
  r.effective_to
from public.utility_rates r
where r.effective_from <= current_date
  and (r.effective_to is null or r.effective_to >= current_date)
order by r.location_id, r.utility, r.effective_from desc;

-- ---------------------------------------------------------------------------
-- 17. RPCs used by the application
-- ---------------------------------------------------------------------------

create or replace function public.finalize_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_invoice public.invoices%rowtype;
begin
  update public.invoices
  set status = 'finalized'
  where id = p_invoice_id and status = 'draft'
  returning * into v_invoice;

  if not found then
    raise exception 'Draft invoice % not found', p_invoice_id;
  end if;
  return v_invoice;
end;
$$;

create or replace function public.void_invoice(p_invoice_id uuid, p_reason text)
returns public.invoices
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_invoice public.invoices%rowtype;
begin
  update public.invoices
  set status = 'void', void_reason = p_reason
  where id = p_invoice_id and status <> 'void'
  returning * into v_invoice;

  if not found then
    raise exception 'Invoice % not found or already void', p_invoice_id;
  end if;
  return v_invoice;
end;
$$;

create or replace function public.record_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method public.payment_method default 'cash',
  p_reference text default '',
  p_paid_at date default current_date,
  p_notes text default ''
)
returns public.payments
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_invoice public.invoices%rowtype;
  v_payment public.payments%rowtype;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'Invoice % not found', p_invoice_id;
  end if;

  insert into public.payments (
    location_id, tenant_id, payment_date, amount, method, reference, notes, received_by
  ) values (
    v_invoice.location_id, v_invoice.tenant_id, coalesce(p_paid_at, current_date),
    p_amount, p_method, coalesce(p_reference, ''), coalesce(p_notes, ''), auth.uid()
  )
  returning * into v_payment;

  insert into public.payment_allocations (payment_id, invoice_id, amount)
  values (v_payment.id, p_invoice_id, p_amount);

  return v_payment;
end;
$$;

create or replace function public.dashboard_summary(
  p_period date default current_date,
  p_location_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_month date := date_trunc('month', coalesce(p_period, current_date))::date;
  v_billed numeric(14, 2) := 0;
  v_collected numeric(14, 2) := 0;
  v_outstanding numeric(14, 2) := 0;
  v_invoice_count integer := 0;
  v_paid_count integer := 0;
  v_expenses numeric(14, 2) := 0;
  v_total_rooms integer := 0;
  v_occupied integer := 0;
begin
  select
    coalesce(sum(total_amount), 0),
    coalesce(sum(amount_paid), 0),
    coalesce(sum(total_amount - amount_paid), 0),
    count(*),
    count(*) filter (where amount_paid >= total_amount)
  into v_billed, v_collected, v_outstanding, v_invoice_count, v_paid_count
  from public.invoices
  where billing_period = v_month
    and status in ('finalized', 'partially_paid', 'paid')
    and (p_location_id is null or location_id = p_location_id);

  select coalesce(sum(amount), 0)
  into v_expenses
  from public.expenses
  where status = 'recorded'
    and expense_date >= v_month
    and expense_date < (v_month + interval '1 month')
    and (p_location_id is null or location_id = p_location_id or location_id is null);

  select count(*), count(*) filter (where status = 'occupied')
  into v_total_rooms, v_occupied
  from public.rooms
  where p_location_id is null or location_id = p_location_id;

  return jsonb_build_object(
    'period', to_char(v_month, 'YYYY-MM'),
    'billing_period', v_month,
    'currency', 'USD',
    'billed', v_billed,
    'collected', v_collected,
    'outstanding', v_outstanding,
    'expenses', v_expenses,
    'net', v_collected - v_expenses,
    'invoice_count', v_invoice_count,
    'paid_invoice_count', v_paid_count,
    'total_rooms', v_total_rooms,
    'occupied_rooms', v_occupied,
    'occupancy_rate', case
      when v_total_rooms = 0 then 0
      else round(v_occupied::numeric / v_total_rooms * 100, 1)
    end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 18. Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.rooms enable row level security;
alter table public.tenants enable row level security;
alter table public.tenancies enable row level security;
alter table public.meters enable row level security;
alter table public.utility_rates enable row level security;
alter table public.meter_readings enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.expenses enable row level security;
alter table public.maintenance_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.settings enable row level security;
alter table public.audit_logs enable row level security;

-- profiles -----------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.rrms_role() = 'admin'
    or (
      public.rrms_is_staff()
      and (public.rrms_location() is null or location_id = public.rrms_location())
    )
  );

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.rrms_role() = 'admin')
  with check (id = auth.uid() or public.rrms_role() = 'admin');

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (public.rrms_role() = 'admin');

create policy profiles_delete on public.profiles
  for delete to authenticated
  using (public.rrms_role() = 'admin');

-- locations ----------------------------------------------------------------
create policy locations_select on public.locations
  for select to authenticated
  using (public.rrms_can_view_location(id) or public.rrms_tenant_has_location(id));

create policy locations_insert on public.locations
  for insert to authenticated
  with check (public.rrms_role() = 'admin');

create policy locations_update on public.locations
  for update to authenticated
  using (
    public.rrms_role() = 'admin'
    or (public.rrms_can_manage() and public.rrms_location() = id)
  )
  with check (
    public.rrms_role() = 'admin'
    or (public.rrms_can_manage() and public.rrms_location() = id)
  );

create policy locations_delete on public.locations
  for delete to authenticated
  using (public.rrms_role() = 'admin');

-- rooms --------------------------------------------------------------------
create policy rooms_select on public.rooms
  for select to authenticated
  using (public.rrms_can_view_location(location_id) or public.rrms_tenant_has_room(id));

create policy rooms_insert on public.rooms
  for insert to authenticated
  with check (
    public.rrms_role() = 'admin'
    or (
      public.rrms_can_manage()
      and (public.rrms_location() is null or public.rrms_location() = location_id)
    )
  );

create policy rooms_update on public.rooms
  for update to authenticated
  using (
    public.rrms_role() = 'admin'
    or (
      public.rrms_can_manage()
      and (public.rrms_location() is null or public.rrms_location() = location_id)
    )
  )
  with check (
    public.rrms_role() = 'admin'
    or (
      public.rrms_can_manage()
      and (public.rrms_location() is null or public.rrms_location() = location_id)
    )
  );

create policy rooms_delete on public.rooms
  for delete to authenticated
  using (
    public.rrms_role() = 'admin'
    or (public.rrms_can_manage() and public.rrms_location() = location_id)
  );

-- tenants ------------------------------------------------------------------
create policy tenants_select on public.tenants
  for select to authenticated
  using (public.rrms_tenant_visible(id) or id = public.rrms_tenant());

create policy tenants_insert on public.tenants
  for insert to authenticated
  with check (public.rrms_can_manage());

create policy tenants_update on public.tenants
  for update to authenticated
  using (public.rrms_can_manage())
  with check (public.rrms_can_manage());

create policy tenants_delete on public.tenants
  for delete to authenticated
  using (public.rrms_role() = 'admin');

-- tenancies ----------------------------------------------------------------
create policy tenancies_select on public.tenancies
  for select to authenticated
  using (public.rrms_can_view_location(location_id) or tenant_id = public.rrms_tenant());

create policy tenancies_insert on public.tenancies
  for insert to authenticated
  with check (
    public.rrms_can_manage()
    and (public.rrms_location() is null or public.rrms_location() = location_id)
  );

create policy tenancies_update on public.tenancies
  for update to authenticated
  using (
    public.rrms_can_manage()
    and (public.rrms_location() is null or public.rrms_location() = location_id)
  )
  with check (
    public.rrms_can_manage()
    and (public.rrms_location() is null or public.rrms_location() = location_id)
  );

create policy tenancies_delete on public.tenancies
  for delete to authenticated
  using (public.rrms_role() = 'admin');

-- meters -------------------------------------------------------------------
create policy meters_select on public.meters
  for select to authenticated
  using (
    public.rrms_can_view_location(location_id)
    or public.rrms_tenant_has_room(room_id)
  );

create policy meters_write on public.meters
  for all to authenticated
  using (
    public.rrms_can_manage()
    and (public.rrms_location() is null or public.rrms_location() = location_id)
  )
  with check (
    public.rrms_can_manage()
    and (public.rrms_location() is null or public.rrms_location() = location_id)
  );

-- utility rates ------------------------------------------------------------
create policy utility_rates_select on public.utility_rates
  for select to authenticated
  using (public.rrms_can_view_location(location_id));

create policy utility_rates_write on public.utility_rates
  for all to authenticated
  using (
    public.rrms_can_manage()
    and (public.rrms_location() is null or public.rrms_location() = location_id)
  )
  with check (
    public.rrms_can_manage()
    and (public.rrms_location() is null or public.rrms_location() = location_id)
  );

-- meter readings -----------------------------------------------------------
create policy meter_readings_select on public.meter_readings
  for select to authenticated
  using (
    public.rrms_can_view_location(location_id)
    or tenancy_id = public.rrms_tenant()
  );

create policy meter_readings_write on public.meter_readings
  for all to authenticated
  using (
    public.rrms_can_bill()
    and (public.rrms_location() is null or public.rrms_location() = location_id)
  )
  with check (
    public.rrms_can_bill()
    and (public.rrms_location() is null or public.rrms_location() = location_id)
  );

-- invoices -----------------------------------------------------------------
create policy invoices_select on public.invoices
  for select to authenticated
  using (
    public.rrms_can_view_location(location_id)
    or tenant_id = public.rrms_tenant()
  );

create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (
    public.rrms_can_bill()
    and (public.rrms_location() is null or public.rrms_location() = location_id)
  );

create policy invoices_update on public.invoices
  for update to authenticated
  using (
    public.rrms_can_bill()
    and (public.rrms_location() is null or public.rrms_location() = location_id)
  )
  with check (
    public.rrms_can_bill()
    and (public.rrms_location() is null or public.rrms_location() = location_id)
  );

create policy invoices_delete on public.invoices
  for delete to authenticated
  using (
    public.rrms_can_bill()
    and (public.rrms_location() is null or public.rrms_location() = location_id)
  );

-- invoice items ------------------------------------------------------------
create policy invoice_items_select on public.invoice_items
  for select to authenticated
  using (exists (
    select 1 from public.invoices i where i.id = invoice_id
  ));

create policy invoice_items_write on public.invoice_items
  for all to authenticated
  using (
    public.rrms_can_bill()
    and exists (
      select 1 from public.invoices i
      where i.id = invoice_id
        and i.status = 'draft'
        and (public.rrms_location() is null or public.rrms_location() = i.location_id)
    )
  )
  with check (
    public.rrms_can_bill()
    and exists (
      select 1 from public.invoices i
      where i.id = invoice_id
        and i.status = 'draft'
        and (public.rrms_location() is null or public.rrms_location() = i.location_id)
    )
  );

-- payments -----------------------------------------------------------------
create policy payments_select on public.payments
  for select to authenticated
  using (
    public.rrms_can_view_location(location_id)
    or tenant_id = public.rrms_tenant()
  );

create policy payments_write on public.payments
  for all to authenticated
  using (
    public.rrms_can_bill()
    and (public.rrms_location() is null or public.rrms_location() = location_id)
  )
  with check (
    public.rrms_can_bill()
    and (public.rrms_location() is null or public.rrms_location() = location_id)
  );

-- payment allocations ------------------------------------------------------
create policy payment_allocations_select on public.payment_allocations
  for select to authenticated
  using (exists (
    select 1 from public.payments p where p.id = payment_id
  ));

create policy payment_allocations_write on public.payment_allocations
  for all to authenticated
  using (
    public.rrms_can_bill()
    and exists (
      select 1 from public.payments p
      where p.id = payment_id
        and p.status = 'completed'
        and (public.rrms_location() is null or public.rrms_location() = p.location_id)
    )
  )
  with check (
    public.rrms_can_bill()
    and exists (
      select 1 from public.payments p
      where p.id = payment_id
        and p.status = 'completed'
        and (public.rrms_location() is null or public.rrms_location() = p.location_id)
    )
  );

-- expenses -----------------------------------------------------------------
create policy expenses_select on public.expenses
  for select to authenticated
  using (
    public.rrms_is_staff()
    and (location_id is null or public.rrms_can_view_location(location_id))
  );

create policy expenses_write on public.expenses
  for all to authenticated
  using (
    public.rrms_can_bill()
    and (location_id is null or public.rrms_can_view_location(location_id))
  )
  with check (
    public.rrms_can_bill()
    and (location_id is null or public.rrms_can_view_location(location_id))
  );

-- maintenance --------------------------------------------------------------
create policy maintenance_select on public.maintenance_requests
  for select to authenticated
  using (
    public.rrms_can_view_location(location_id)
    or reported_by_tenant_id = public.rrms_tenant()
  );

create policy maintenance_write on public.maintenance_requests
  for all to authenticated
  using (
    public.rrms_can_manage()
    and (public.rrms_location() is null or public.rrms_location() = location_id)
  )
  with check (
    public.rrms_can_manage()
    and (public.rrms_location() is null or public.rrms_location() = location_id)
  );

-- notifications ------------------------------------------------------------
create policy notifications_select on public.notifications
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      user_id is null
      and (location_id is null or public.rrms_can_view_location(location_id))
    )
  );

create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = auth.uid() or public.rrms_role() = 'admin')
  with check (user_id = auth.uid() or public.rrms_role() = 'admin');

create policy notifications_insert on public.notifications
  for insert to authenticated
  with check (public.rrms_role() = 'admin' or public.rrms_can_manage());

create policy notifications_delete on public.notifications
  for delete to authenticated
  using (public.rrms_role() = 'admin');

-- settings -----------------------------------------------------------------
create policy settings_select on public.settings
  for select to authenticated
  using (public.rrms_is_staff());

create policy settings_write on public.settings
  for all to authenticated
  using (public.rrms_role() = 'admin')
  with check (public.rrms_role() = 'admin');

-- audit logs ---------------------------------------------------------------
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (public.rrms_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 19. Privileges
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public;

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
  public.profiles,
  public.locations,
  public.rooms,
  public.tenants,
  public.tenancies,
  public.meters,
  public.utility_rates,
  public.meter_readings,
  public.invoices,
  public.invoice_items,
  public.payments,
  public.payment_allocations,
  public.expenses,
  public.maintenance_requests,
  public.notifications,
  public.settings
to authenticated;

grant select on public.audit_logs to authenticated;

grant select on
  public.v_room_occupancy,
  public.v_tenancy_overview,
  public.v_invoice_ledger,
  public.v_monthly_financials,
  public.v_location_snapshot,
  public.v_latest_readings,
  public.v_expiring_tenancies,
  public.v_tenant_balances,
  public.v_open_maintenance,
  public.v_utility_rates_current
to authenticated;

grant usage, select on all sequences in schema public to authenticated;

grant execute on function
  public.rrms_role(),
  public.rrms_location(),
  public.rrms_tenant(),
  public.rrms_is_staff(),
  public.rrms_can_manage(),
  public.rrms_can_bill(),
  public.rrms_can_view_location(uuid),
  public.rrms_tenant_visible(uuid),
  public.rrms_tenant_has_location(uuid),
  public.rrms_tenant_has_room(uuid)
to authenticated;

grant execute on function
  public.finalize_invoice(uuid),
  public.void_invoice(uuid, text),
  public.record_payment(uuid, numeric, public.payment_method, text, date, text),
  public.dashboard_summary(date, uuid)
to authenticated;

commit;

