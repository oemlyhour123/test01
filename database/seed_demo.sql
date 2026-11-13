-- ============================================================================
-- RRMS — Phase 1 demo history (optional)
--
-- Generates 12 months of meter readings, invoices, payments, expenses,
-- maintenance requests and notifications on top of seed.sql. Everything is
-- deterministic: re-running the file does nothing once the marker setting
-- demo.seeded_at exists.
--
-- To rebuild the demo dataset:
--   delete from settings where key = 'demo.seeded_at';
--   truncate payments, payment_allocations, invoices, invoice_items,
--     meter_readings, expenses, maintenance_requests, notifications cascade;
--   \i database/seed_demo.sql
--
-- Notes
--   * Room 1-204 and room 2-202 intentionally have no current-month reading,
--     which produces the "missing reading" dashboard alert.
--   * Room 1-201 has a 3x electricity spike in the current month.
--   * Tenancy TN-006 ends in 24 days, producing the contract-expiring alert.
-- ============================================================================

begin;

create or replace function pg_temp.demo_rand(p_key text)
returns integer
language sql
immutable
as $$
  select (('x' || substr(md5(p_key), 1, 8))::bit(32)::int) & 2147483647
$$;

do $$
declare
  v_current_month date := date_trunc('month', current_date)::date;
  v_window_start  date := (date_trunc('month', current_date) - interval '11 months')::date;
  v_month         date;
  v_month_end     date;
  v_start_month   date;
  v_issue         date;
  v_due           date;
  v_pay_date      date;
  v_expense_date  date;
  v_reading_date  date;

  v_tenancy       record;
  v_location      record;

  v_elec_prev     numeric(14, 2);
  v_water_prev    numeric(14, 2);
  v_elec_curr     numeric(14, 2);
  v_water_curr    numeric(14, 2);
  v_elec_usage    integer;
  v_water_usage   integer;
  v_elec_rate     numeric(12, 4);
  v_water_rate    numeric(12, 4);
  v_elec_reading_id uuid;
  v_water_reading_id uuid;

  v_seed          integer;
  v_pay_seed      integer;
  v_invoice_id    uuid;
  v_payment_id    uuid;
  v_total         numeric(12, 2);
  v_pay_amount    numeric(12, 2);
  v_age           integer;
  v_behavior      text;
  v_method        public.payment_method;
  v_reference     text;
  v_other         numeric(12, 2);
  v_count_invoices integer := 0;
  v_count_payments integer := 0;
begin
  if exists (select 1 from public.settings where key = 'demo.seeded_at') then
    raise notice 'Demo history already seeded; nothing to do.';
    return;
  end if;

  -- -----------------------------------------------------------------------
  -- Readings, invoices and payments, one tenancy at a time so each meter
  -- keeps a realistic cumulative chain.
  -- -----------------------------------------------------------------------
  for v_tenancy in
    select
      t.id, t.code, t.tenant_id, t.room_id, t.location_id,
      t.start_date, t.end_date, t.monthly_rent,
      r.room_number, r.room_type,
      l.code as location_code,
      em.id as elec_meter_id, em.initial_reading as elec_initial,
      wm.id as water_meter_id, wm.initial_reading as water_initial
    from public.tenancies t
    join public.rooms r on r.id = t.room_id
    join public.locations l on l.id = t.location_id
    join public.meters em
      on em.room_id = t.room_id and em.utility = 'electricity' and em.status = 'active'
    join public.meters wm
      on wm.room_id = t.room_id and wm.utility = 'water' and wm.status = 'active'
    where t.status = 'active'
    order by t.code
  loop
    v_start_month := greatest(
      date_trunc('month', v_tenancy.start_date)::date,
      v_window_start
    );
    v_elec_prev := v_tenancy.elec_initial;
    v_water_prev := v_tenancy.water_initial;

    v_elec_rate := coalesce((
      select rate from public.utility_rates
      where location_id = v_tenancy.location_id
        and utility = 'electricity'
        and effective_from <= v_current_month
        and (effective_to is null or effective_to >= v_current_month)
      order by effective_from desc limit 1
    ), 0.25);
    v_water_rate := coalesce((
      select rate from public.utility_rates
      where location_id = v_tenancy.location_id
        and utility = 'water'
        and effective_from <= v_current_month
        and (effective_to is null or effective_to >= v_current_month)
      order by effective_from desc limit 1
    ), 0.50);

    for v_month in
      select generate_series(v_start_month, v_current_month, interval '1 month')::date
    loop
      if v_tenancy.end_date is not null and v_tenancy.end_date < v_month then
        exit;
      end if;

      -- Intentional missing readings for the current month.
      if v_month = v_current_month
         and (
           (v_tenancy.location_code = 'loc-1' and v_tenancy.room_number = '204')
           or (v_tenancy.location_code = 'loc-2' and v_tenancy.room_number = '202')
         ) then
        continue;
      end if;

      v_month_end := (v_month + interval '1 month' - interval '1 day')::date;
      v_reading_date := case
        when v_month = v_current_month then current_date
        else v_month_end
      end;

      v_seed := pg_temp.demo_rand(
        v_tenancy.code || ':' || to_char(v_month, 'YYYY-MM')
      );

      case v_tenancy.room_type
        when 'large' then
          v_elec_usage := 135 + mod(v_seed, 111);
          v_water_usage := 11 + mod(v_seed, 13);
        when 'small' then
          v_elec_usage := 65 + mod(v_seed, 71);
          v_water_usage := 5 + mod(v_seed, 9);
        else
          v_elec_usage := 90 + mod(v_seed, 101);
          v_water_usage := 8 + mod(v_seed, 11);
      end case;

      if v_month = v_current_month
         and v_tenancy.location_code = 'loc-1'
         and v_tenancy.room_number = '201' then
        v_elec_usage := v_elec_usage * 3;
      end if;

      v_elec_curr := v_elec_prev + v_elec_usage;
      v_water_curr := v_water_prev + v_water_usage;

      insert into public.meter_readings (
        meter_id, location_id, room_id, tenancy_id, utility, period_start,
        reading_date, previous_reading, current_reading, rate, status, notes
      ) values (
        v_tenancy.elec_meter_id, v_tenancy.location_id, v_tenancy.room_id,
        v_tenancy.id, 'electricity', v_month, v_reading_date,
        v_elec_prev, v_elec_curr, v_elec_rate, 'confirmed', 'Demo history'
      ) returning id into v_elec_reading_id;

      insert into public.meter_readings (
        meter_id, location_id, room_id, tenancy_id, utility, period_start,
        reading_date, previous_reading, current_reading, rate, status, notes
      ) values (
        v_tenancy.water_meter_id, v_tenancy.location_id, v_tenancy.room_id,
        v_tenancy.id, 'water', v_month, v_reading_date,
        v_water_prev, v_water_curr, v_water_rate, 'confirmed', 'Demo history'
      ) returning id into v_water_reading_id;

      v_elec_prev := v_elec_curr;
      v_water_prev := v_water_curr;

      v_issue := least((v_month + interval '2 days')::date, current_date);
      v_due := (v_month + interval '1 month' + interval '4 days')::date;

      insert into public.invoices (
        location_id, room_id, tenancy_id, tenant_id, billing_period,
        issue_date, due_date, previous_balance, notes
      ) values (
        v_tenancy.location_id, v_tenancy.room_id, v_tenancy.id, v_tenancy.tenant_id,
        v_month, v_issue, v_due, 0, 'Demo history'
      ) returning id into v_invoice_id;

      insert into public.invoice_items (
        invoice_id, item_type, description_km, description_en,
        quantity, unit_price, amount, meter_reading_id, sort_order
      ) values (
        v_invoice_id, 'rent',
        'ថ្លៃឈ្នួលប្រចាំខែ', 'Monthly rent',
        1, v_tenancy.monthly_rent, v_tenancy.monthly_rent, null, 1
      );

      insert into public.invoice_items (
        invoice_id, item_type, description_km, description_en,
        quantity, unit_price, amount, meter_reading_id, sort_order
      ) values (
        v_invoice_id, 'electricity',
        'ថ្លៃអគ្គិសនី ' || v_elec_usage || ' kWh',
        'Electricity ' || v_elec_usage || ' kWh',
        v_elec_usage, v_elec_rate,
        round((v_elec_usage * v_elec_rate)::numeric, 2),
        v_elec_reading_id, 2
      );

      insert into public.invoice_items (
        invoice_id, item_type, description_km, description_en,
        quantity, unit_price, amount, meter_reading_id, sort_order
      ) values (
        v_invoice_id, 'water',
        'ថ្លៃទឹក ' || v_water_usage || ' m³',
        'Water ' || v_water_usage || ' m³',
        v_water_usage, v_water_rate,
        round((v_water_usage * v_water_rate)::numeric, 2),
        v_water_reading_id, 3
      );

      v_other := case when mod(v_seed, 100) < 12 then 5.00 else 0 end;
      if v_other > 0 then
        insert into public.invoice_items (
          invoice_id, item_type, description_km, description_en,
          quantity, unit_price, amount, sort_order
        ) values (
          v_invoice_id, 'other',
          'សេវាកម្មផ្សេងៗ', 'Other charges',
          1, v_other, v_other, 4
        );
      end if;

      update public.invoices set status = 'finalized' where id = v_invoice_id;
      select total_amount into v_total from public.invoices where id = v_invoice_id;
      v_count_invoices := v_count_invoices + 1;

      v_age := (
        (extract(year from v_current_month)::int - extract(year from v_month)::int) * 12
        + (extract(month from v_current_month)::int - extract(month from v_month)::int)
      );
      v_pay_seed := pg_temp.demo_rand(
        v_tenancy.code || ':' || to_char(v_month, 'YYYY-MM') || ':pay'
      );

      if v_age = 0 then
        if mod(v_pay_seed, 9) = 0 then v_behavior := 'paid';
        elsif mod(v_pay_seed, 9) in (1, 2) then v_behavior := 'partial';
        else v_behavior := 'unpaid';
        end if;
      elsif v_age <= 2 then
        if mod(v_pay_seed, 8) = 0 then v_behavior := 'unpaid';
        elsif mod(v_pay_seed, 6) = 0 then v_behavior := 'partial';
        else v_behavior := 'paid';
        end if;
      else
        if mod(v_pay_seed, 23) = 0 then v_behavior := 'unpaid';
        elsif mod(v_pay_seed, 17) = 0 then v_behavior := 'partial';
        else v_behavior := 'paid';
        end if;
      end if;

      if v_behavior <> 'unpaid' then
        if v_behavior = 'paid' then
          v_pay_amount := v_total;
        else
          v_pay_amount := round(
            (v_total * (0.35 + mod(v_pay_seed, 31) / 100.0))::numeric, 2
          );
        end if;

        v_method := (array[
          'cash'::public.payment_method,
          'cash'::public.payment_method,
          'cash'::public.payment_method,
          'aba'::public.payment_method,
          'aba'::public.payment_method,
          'acleda'::public.payment_method,
          'bank_transfer'::public.payment_method
        ])[1 + mod(v_pay_seed, 7)];

        v_reference := case
          when v_method = 'cash' then ''
          else upper(left(v_method::text, 6)) || '-' ||
               (100000 + mod(v_pay_seed, 900000))::text
        end;

        v_pay_date := least(
          (v_issue + (2 + mod(v_pay_seed, 11)))::date,
          current_date
        );

        insert into public.payments (
          location_id, tenant_id, payment_date, amount, method, reference, notes
        ) values (
          v_tenancy.location_id, v_tenancy.tenant_id, v_pay_date,
          v_pay_amount, v_method, v_reference, 'Demo history'
        ) returning id into v_payment_id;

        insert into public.payment_allocations (payment_id, invoice_id, amount)
        values (v_payment_id, v_invoice_id, v_pay_amount);

        v_count_payments := v_count_payments + 1;
      end if;
    end loop;
  end loop;

  -- -----------------------------------------------------------------------
  -- Operating expenses, four lines per location per month.
  -- -----------------------------------------------------------------------
  for v_month in
    select generate_series(v_window_start, v_current_month, interval '1 month')::date
  loop
    for v_location in
      select id, code from public.locations order by sort_order
    loop
      v_seed := pg_temp.demo_rand(
        'expense:' || v_location.code || ':' || to_char(v_month, 'YYYY-MM')
      );
      v_expense_date := least((v_month + interval '5 days')::date, current_date);

      insert into public.expenses (
        location_id, category, description, amount, expense_date, vendor, notes
      ) values
        (v_location.id, 'utilities', 'ថ្លៃអគ្គិសនី និងទឹក', 55 + mod(v_seed, 45),
         v_expense_date, 'EDC / PPWSA', 'Demo history'),
        (v_location.id, 'repairs', 'ជួសជុល និងថែទាំ', 20 + mod(v_seed, 60),
         v_expense_date, 'Local contractor', 'Demo history'),
        (v_location.id, 'salaries', 'ប្រាក់ខែអ្នកគ្រប់គ្រង', 180 + mod(v_seed, 80),
         v_expense_date, 'Payroll', 'Demo history'),
        (v_location.id, 'supplies', 'សម្ភារៈសម្អាត', 15 + mod(v_seed, 30),
         v_expense_date, 'Local supplier', 'Demo history');
    end loop;
  end loop;

  -- -----------------------------------------------------------------------
  -- Maintenance requests.
  -- -----------------------------------------------------------------------
  insert into public.maintenance_requests (
    location_id, room_id, tenancy_id, title, description, priority, status,
    reported_at, scheduled_for, resolved_at, cost, notes
  ) values
    (
      '10000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000010205',
      null,
      'ជួសជុលបន្ទប់ទឹក និងពិដាន',
      'បន្ទប់ទឹកលេចទឹក និងពិដានមានស្នាមប្រេះ ត្រូវជួសជុលមុនពេលជួលឡើងវិញ។',
      'high', 'open', now() - interval '3 days', now() + interval '2 days', null, 0,
      'Demo history'
    ),
    (
      '10000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000020204',
      null,
      'លាបថ្នាំជញ្ជាំងឡើងវិញ',
      'ជញ្ជាំងមានស្នាម ត្រូវលាបថ្នាំពណ៌សឡើងវិញមុនពេលជួល។',
      'medium', 'in_progress', now() - interval '7 days', now() + interval '1 day', null, 0,
      'Demo history'
    ),
    (
      '10000000-0000-4000-8000-000000000001',
      null,
      null,
      'ជួសជុលចង្កៀងផ្លូវ',
      'ចង្កៀងផ្លូវចូលជណ្តើរមិនភ្លឺ ត្រូវប្តូរអំពូល។',
      'low', 'resolved', now() - interval '14 days', now() - interval '12 days',
      now() - interval '10 days', 12, 'Demo history'
    ),
    (
      '10000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000020201',
      '40000000-0000-4000-8000-000000000013',
      'ទឹកលេចធ្លាយពីម៉ាស៊ីនត្រជាក់',
      'អ្នកជួលរាយការណ៍ថាមានទឹកលេចធ្លាយពីម៉ាស៊ីនត្រជាក់ក្នុងបន្ទប់គេង។',
      'urgent', 'open', now() - interval '1 day', now() + interval '4 hours', null, 0,
      'Demo history'
    );

  -- -----------------------------------------------------------------------
  -- Notifications: missing readings, expiring contract, overdue invoices.
  -- -----------------------------------------------------------------------
  insert into public.notifications (
    location_id, type, title_km, title_en, body_km, body_en,
    link, entity_type, entity_id
  )
  select
    r.location_id,
    'missing_reading',
    'ខ្វះការអានម៉ែត្រ',
    'Missing meter reading',
    'មិនទាន់មានការអានម៉ែត្រសម្រាប់បន្ទប់ ' || r.room_number || ' ប្រចាំខែនេះទេ។',
    'No meter reading has been recorded for room ' || r.room_number || ' this month.',
    '/pages/dashboard.html',
    'room',
    r.id::text
  from public.rooms r
  where r.status = 'occupied'
    and not exists (
      select 1 from public.meter_readings mr
      where mr.room_id = r.id and mr.period_start = v_current_month
    );

  insert into public.notifications (
    location_id, type, title_km, title_en, body_km, body_en,
    link, entity_type, entity_id
  )
  select
    t.location_id,
    'contract_expiring',
    'កិច្ចសន្យាជិតផុតកំណត់',
    'Contract expiring soon',
    'កិច្ចសន្យារបស់ ' || t.tenant_name_km || ' ត្រូវផុតកំណត់ក្នុងរយៈពេល ' ||
      t.days_until_end || ' ថ្ងៃទៀត។',
    'The contract for ' || t.tenant_name_en || ' expires in ' ||
      t.days_until_end || ' days.',
    '/pages/dashboard.html',
    'tenancy',
    t.id::text
  from public.v_expiring_tenancies t;

  insert into public.notifications (
    location_id, type, title_km, title_en, body_km, body_en,
    link, entity_type, entity_id
  )
  select
    i.location_id,
    'invoice_overdue',
    'វិក្កយបត្រហួសកំណត់',
    'Invoice overdue',
    'វិក្កយបត្រ ' || i.invoice_number || ' របស់បន្ទប់ ' || i.room_number ||
      ' ហួសកំណត់ទូទាត់ហើយ។',
    'Invoice ' || i.invoice_number || ' for room ' || i.room_number ||
      ' is past due.',
    '/pages/dashboard.html',
    'invoice',
    i.id::text
  from public.v_invoice_ledger i
  where i.is_overdue
  order by i.due_date
  limit 3;

  insert into public.settings (key, value, description) values (
    'demo.seeded_at',
    to_jsonb(now()),
    'Marker written by seed_demo.sql; remove it to re-run the demo generator.'
  )
  on conflict (key) do update
    set value = excluded.value,
        description = excluded.description,
        updated_at = now();

  raise notice 'Demo history created: % invoices, % payments.',
    v_count_invoices, v_count_payments;
end;
$$;

commit;
