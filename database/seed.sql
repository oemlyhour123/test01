-- ============================================================================
-- RRMS — Phase 1 base seed
--
-- Creates the two demo locations, 22 rooms, 16 active tenancies, their meters
-- and utility rates. Financial history lives in seed_demo.sql.
--
-- The seed is idempotent (fixed UUIDs + ON CONFLICT DO NOTHING). It does not
-- create auth users: sign up through Supabase Auth, then set the profile role
-- to admin with:
--   update public.profiles set role = 'admin', full_name = '...' where id = '<uuid>';
-- ============================================================================

begin;

-- Settings ------------------------------------------------------------------
insert into public.settings (key, value, description) values
  ('company.name_km', '"អាជីវកម្មជួលបន្ទប់ រាជធានីភ្នំពេញ"'::jsonb, 'Company name in Khmer'),
  ('company.name_en', '"Phnom Penh Rental Properties"'::jsonb, 'Company name in English'),
  ('company.currency', '"USD"'::jsonb, 'Primary currency'),
  ('company.secondary_currency', '"KHR"'::jsonb, 'Secondary display currency'),
  ('company.exchange_rate_khr', '4100'::jsonb, 'KHR per USD for display only'),
  ('billing.default_electricity_rate', '0.25'::jsonb, 'USD per kWh for new locations'),
  ('billing.default_water_rate', '0.50'::jsonb, 'USD per m3 for new locations'),
  ('billing.default_rent', '125'::jsonb, 'USD per month for a standard room'),
  ('billing.invoice_due_day', '5'::jsonb, 'Day of the following month invoices are due'),
  ('app.default_language', '"km"'::jsonb, 'Default UI language'),
  ('app.date_format', '"DD MMMM YYYY"'::jsonb, 'Display date format')
on conflict (key) do nothing;

-- Locations -----------------------------------------------------------------
insert into public.locations (
  id, code, name_km, name_en, address_km, address_en,
  description_km, description_en, contact_name, contact_phone,
  status, currency, sort_order
) values
  (
    '10000000-0000-4000-8000-000000000001', 'loc-1',
    'ទីតាំងទី១', 'Location 1',
    'សង្កាត់បឹងព្រលឹត ខណ្ឌ៧មករា រាជធានីភ្នំពេញ',
    'Boeng Proluet, Khan 7 Makara, Phnom Penh',
    'អគារជួល ២ ជាន់ ចំនួន ១២ បន្ទប់ មានបន្ទប់ទឹកឯកជន។',
    'Two-storey rental building with 12 en-suite rooms.',
    'លោក សំណាង', '012 345 678', 'active', 'USD', 1
  ),
  (
    '10000000-0000-4000-8000-000000000002', 'loc-2',
    'ទីតាំងទី២', 'Location 2',
    'សង្កាត់ទួលស្គុល ខណ្ឌសែនសុខ រាជធានីភ្នំពេញ',
    'Tuek Thla, Khan Sen Sok, Phnom Penh',
    'ផ្ទះជួល ២ ជាន់ ចំនួន ១០ បន្ទប់ នៅជិតផ្សារទួលស្គុល។',
    'Two-storey rental house with 10 rooms near Tuek Thla market.',
    'លោកស្រី សុភា', '098 765 432', 'active', 'USD', 2
  )
on conflict do nothing;

-- Rooms ---------------------------------------------------------------------
insert into public.rooms (
  id, location_id, room_number, floor, room_type, monthly_rent, status, notes, sort_order
) values
  -- Location 1
  ('30000000-0000-4000-8000-000000010101', '10000000-0000-4000-8000-000000000001', '101', 1, 'standard', 125, 'occupied',   '', 1),
  ('30000000-0000-4000-8000-000000010102', '10000000-0000-4000-8000-000000000001', '102', 1, 'standard', 125, 'occupied',   '', 2),
  ('30000000-0000-4000-8000-000000010103', '10000000-0000-4000-8000-000000000001', '103', 1, 'standard', 125, 'vacant',     '', 3),
  ('30000000-0000-4000-8000-000000010104', '10000000-0000-4000-8000-000000000001', '104', 1, 'large',    150, 'occupied',   '', 4),
  ('30000000-0000-4000-8000-000000010105', '10000000-0000-4000-8000-000000000001', '105', 1, 'standard', 125, 'occupied',   '', 5),
  ('30000000-0000-4000-8000-000000010106', '10000000-0000-4000-8000-000000000001', '106', 1, 'standard', 125, 'reserved',   '', 6),
  ('30000000-0000-4000-8000-000000010201', '10000000-0000-4000-8000-000000000001', '201', 2, 'standard', 125, 'occupied',   '', 7),
  ('30000000-0000-4000-8000-000000010202', '10000000-0000-4000-8000-000000000001', '202', 2, 'large',    150, 'occupied',   '', 8),
  ('30000000-0000-4000-8000-000000010203', '10000000-0000-4000-8000-000000000001', '203', 2, 'standard', 125, 'occupied',   '', 9),
  ('30000000-0000-4000-8000-000000010204', '10000000-0000-4000-8000-000000000001', '204', 2, 'small',    110, 'occupied',   '', 10),
  ('30000000-0000-4000-8000-000000010205', '10000000-0000-4000-8000-000000000001', '205', 2, 'standard', 125, 'maintenance', 'កំពុងជួសជុលបន្ទប់ទឹក និងពិដាន។', 11),
  ('30000000-0000-4000-8000-000000010206', '10000000-0000-4000-8000-000000000001', '206', 2, 'standard', 125, 'occupied',   '', 12),
  -- Location 2
  ('30000000-0000-4000-8000-000000020101', '10000000-0000-4000-8000-000000000002', '101', 1, 'standard', 125, 'occupied',   '', 1),
  ('30000000-0000-4000-8000-000000020102', '10000000-0000-4000-8000-000000000002', '102', 1, 'standard', 125, 'occupied',   '', 2),
  ('30000000-0000-4000-8000-000000020103', '10000000-0000-4000-8000-000000000002', '103', 1, 'standard', 125, 'vacant',     '', 3),
  ('30000000-0000-4000-8000-000000020104', '10000000-0000-4000-8000-000000000002', '104', 1, 'large',    150, 'occupied',   '', 4),
  ('30000000-0000-4000-8000-000000020105', '10000000-0000-4000-8000-000000000002', '105', 1, 'standard', 125, 'reserved',   '', 5),
  ('30000000-0000-4000-8000-000000020201', '10000000-0000-4000-8000-000000000002', '201', 2, 'standard', 125, 'occupied',   '', 6),
  ('30000000-0000-4000-8000-000000020202', '10000000-0000-4000-8000-000000000002', '202', 2, 'standard', 125, 'occupied',   '', 7),
  ('30000000-0000-4000-8000-000000020203', '10000000-0000-4000-8000-000000000002', '203', 2, 'standard', 125, 'occupied',   '', 8),
  ('30000000-0000-4000-8000-000000020204', '10000000-0000-4000-8000-000000000002', '204', 2, 'standard', 125, 'maintenance', '', 9),
  ('30000000-0000-4000-8000-000000020205', '10000000-0000-4000-8000-000000000002', '205', 2, 'large',    150, 'occupied',   '', 10)
on conflict do nothing;

-- Tenants -------------------------------------------------------------------
insert into public.tenants (
  id, code, name_km, name_en, phone, email, id_number,
  address_km, address_en, emergency_contact_name, emergency_contact_phone
) values
  ('20000000-0000-4000-8000-000000000001', 'T-0001', 'សុខ ចន្ធា',      'Sok Chanthea',  '010 245 118', 'tenant1@example.com',  '0110234567', 'សង្កាត់បឹងព្រលឹត ខណ្ឌ៧មករា', 'Boeng Proluet, Khan 7 Makara', 'គង់ វិចិត្រ', '011 382 904'),
  ('20000000-0000-4000-8000-000000000002', 'T-0002', 'គង់ វិចិត្រ',      'Kong Vichet',   '012 771 603', '',                     '0129384721', 'សង្កាត់បឹងព្រលឹត ខណ្ឌ៧មករា', 'Boeng Proluet, Khan 7 Makara', 'លី ម៉េងហុង', '017 220 487'),
  ('20000000-0000-4000-8000-000000000003', 'T-0003', 'លី ម៉េងហុង',     'Ly Meng Hong',  '015 609 284', 'tenant3@example.com',  '0938471029', 'សង្កាត់បឹងព្រលឹត ខណ្ឌ៧មករា', 'Boeng Proluet, Khan 7 Makara', 'ចាន់ សុភា', '096 455 210'),
  ('20000000-0000-4000-8000-000000000004', 'T-0004', 'ចាន់ សុភា',       'Chan Sopheak',  '016 330 947', '',                     '0102938475', 'សង្កាត់ទួលស្គុល ខណ្ឌសែនសុខ', 'Tuek Thla, Khan Sen Sok', 'ហ៊ុន ស្រីនី', '078 201 552'),
  ('20000000-0000-4000-8000-000000000005', 'T-0005', 'ហ៊ុន ស្រីនី',      'Hun Sreyny',    '017 884 120', 'tenant5@example.com',  '0192837465', 'សង្កាត់បឹងព្រលឹត ខណ្ឌ៧មករា', 'Boeng Proluet, Khan 7 Makara', 'ព្រាប វណ្ណា', '092 847 631'),
  ('20000000-0000-4000-8000-000000000006', 'T-0006', 'ព្រាប វណ្ណា',      'Preap Vanna',   '078 412 965', '',                     '0139485726', 'សង្កាត់ទួលស្គុល ខណ្ឌសែនសុខ', 'Tuek Thla, Khan Sen Sok', 'ស៊ុន រតនា', '011 572 309'),
  ('20000000-0000-4000-8000-000000000007', 'T-0007', 'ស៊ុន រតនា',       'Sun Rattana',   '092 607 318', 'tenant7@example.com',  '0158374926', 'សង្កាត់បឹងព្រលឹត ខណ្ឌ៧មករា', 'Boeng Proluet, Khan 7 Makara', 'ម៉ៅ សុវណ្ណ', '010 763 845'),
  ('20000000-0000-4000-8000-000000000008', 'T-0008', 'ម៉ៅ សុវណ្ណ',      'Mao Sovann',    '095 221 470', '',                     '0126473890', 'សង្កាត់ទួលស្គុល ខណ្ឌសែនសុខ', 'Tuek Thla, Khan Sen Sok', 'តាំង ហួយ', '096 310 284'),
  ('20000000-0000-4000-8000-000000000009', 'T-0009', 'តាំង ហួយ',       'Tang Houy',     '011 749 236', 'tenant9@example.com',  '0182937465', 'សង្កាត់បឹងព្រលឹត ខណ្ឌ៧មករា', 'Boeng Proluet, Khan 7 Makara', 'ញ៉ែម សុជាតា', '077 628 419'),
  ('20000000-0000-4000-8000-000000000010', 'T-0010', 'ញ៉ែម សុជាតា',     'Nhem Socheata', '077 380 625', '',                     '0147283946', 'សង្កាត់ទួលស្គុល ខណ្ឌសែនសុខ', 'Tuek Thla, Khan Sen Sok', 'ឌី វីរៈ', '098 264 735'),
  ('20000000-0000-4000-8000-000000000011', 'T-0011', 'ឌី វីរៈ',        'Dy Virak',      '098 514 309', 'tenant11@example.com', '0193746258', 'សង្កាត់បឹងព្រលឹត ខណ្ឌ៧មករា', 'Boeng Proluet, Khan 7 Makara', 'ហ៊ឹម ស្រីល័ក្ខណ៍', '012 684 930'),
  ('20000000-0000-4000-8000-000000000012', 'T-0012', 'ហ៊ឹម ស្រីល័ក្ខណ៍', 'Him Sreyleak',  '012 836 570', '',                     '0162839475', 'សង្កាត់ទួលស្គុល ខណ្ឌសែនសុខ', 'Tuek Thla, Khan Sen Sok', 'សេង ដារា', '015 730 482'),
  ('20000000-0000-4000-8000-000000000013', 'T-0013', 'សេង ដារា',       'Seng Dara',     '015 284 917', 'tenant13@example.com', '0173648295', 'សង្កាត់បឹងព្រលឹត ខណ្ឌ៧មករា', 'Boeng Proluet, Khan 7 Makara', 'កែវ សុខឡា', '017 628 504'),
  ('20000000-0000-4000-8000-000000000014', 'T-0014', 'កែវ សុខឡា',      'Keo Sokha',     '017 645 820', '',                     '0104758392', 'សង្កាត់ទួលស្គុល ខណ្ឌសែនសុខ', 'Tuek Thla, Khan Sen Sok', 'អ៊ឹម ច័ន្ទថា', '096 540 372'),
  ('20000000-0000-4000-8000-000000000015', 'T-0015', 'អ៊ឹម ច័ន្ទថា',    'Im Chanthy',   '096 720 438', 'tenant15@example.com', '0184756293', 'សង្កាត់បឹងព្រលឹត ខណ្ឌ៧មករា', 'Boeng Proluet, Khan 7 Makara', 'ប៊ុន សំណាង', '078 316 940'),
  ('20000000-0000-4000-8000-000000000016', 'T-0016', 'ប៊ុន សំណាង',     'Bun Samnang',   '078 930 614', '',                     '0115463728', 'សង្កាត់ទួលស្គុល ខណ្ឌសែនសុខ', 'Tuek Thla, Khan Sen Sok', 'មាស ធីរី', '011 482 659')
on conflict do nothing;

-- Tenancies -----------------------------------------------------------------
-- Start dates are relative to today so the demo always looks current.
-- Tenant 6 has a contract expiring in 24 days; tenant 13 in 280 days.
insert into public.tenancies (
  id, code, tenant_id, room_id, location_id, start_date, end_date,
  monthly_rent, deposit_amount, deposit_paid, status, notes
) values
  ('40000000-0000-4000-8000-000000000001', 'TN-001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000010101', '10000000-0000-4000-8000-000000000001', current_date - interval '11 months 6 days', null, 125, 125, 125, 'active', ''),
  ('40000000-0000-4000-8000-000000000002', 'TN-002', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000010102', '10000000-0000-4000-8000-000000000001', current_date - interval '9 months 12 days', null, 125, 125, 125, 'active', ''),
  ('40000000-0000-4000-8000-000000000003', 'TN-003', '20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000010104', '10000000-0000-4000-8000-000000000001', current_date - interval '7 months 18 days', null, 150, 150, 150, 'active', ''),
  ('40000000-0000-4000-8000-000000000004', 'TN-004', '20000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000010105', '10000000-0000-4000-8000-000000000001', current_date - interval '10 months 3 days', null, 125, 125, 125, 'active', ''),
  ('40000000-0000-4000-8000-000000000005', 'TN-005', '20000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000010201', '10000000-0000-4000-8000-000000000001', current_date - interval '8 months 21 days', null, 125, 125, 125, 'active', ''),
  ('40000000-0000-4000-8000-000000000006', 'TN-006', '20000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000010202', '10000000-0000-4000-8000-000000000001', current_date - interval '12 months 2 days', current_date + 24, 150, 150, 150, 'active', 'កិច្ចសន្យាជិតផុតកំណត់'),
  ('40000000-0000-4000-8000-000000000007', 'TN-007', '20000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000010203', '10000000-0000-4000-8000-000000000001', current_date - interval '6 months 9 days', null, 125, 125, 125, 'active', ''),
  ('40000000-0000-4000-8000-000000000008', 'TN-008', '20000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000010204', '10000000-0000-4000-8000-000000000001', current_date - interval '5 months 14 days', null, 110, 110, 110, 'active', ''),
  ('40000000-0000-4000-8000-000000000009', 'TN-009', '20000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000010206', '10000000-0000-4000-8000-000000000001', current_date - interval '4 months 27 days', null, 125, 125, 125, 'active', ''),
  ('40000000-0000-4000-8000-000000000010', 'TN-010', '20000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000020101', '10000000-0000-4000-8000-000000000002', current_date - interval '8 months 6 days', null, 125, 125, 125, 'active', ''),
  ('40000000-0000-4000-8000-000000000011', 'TN-011', '20000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000020102', '10000000-0000-4000-8000-000000000002', current_date - interval '10 months 17 days', null, 125, 125, 125, 'active', ''),
  ('40000000-0000-4000-8000-000000000012', 'TN-012', '20000000-0000-4000-8000-000000000012', '30000000-0000-4000-8000-000000020104', '10000000-0000-4000-8000-000000000002', current_date - interval '3 months 11 days', null, 150, 150, 150, 'active', ''),
  ('40000000-0000-4000-8000-000000000013', 'TN-013', '20000000-0000-4000-8000-000000000013', '30000000-0000-4000-8000-000000020201', '10000000-0000-4000-8000-000000000002', current_date - interval '2 months 23 days', current_date + 280, 125, 125, 125, 'active', ''),
  ('40000000-0000-4000-8000-000000000014', 'TN-014', '20000000-0000-4000-8000-000000000014', '30000000-0000-4000-8000-000000020202', '10000000-0000-4000-8000-000000000002', current_date - interval '7 months 1 day', null, 125, 125, 125, 'active', ''),
  ('40000000-0000-4000-8000-000000000015', 'TN-015', '20000000-0000-4000-8000-000000000015', '30000000-0000-4000-8000-000000020203', '10000000-0000-4000-8000-000000000002', current_date - interval '6 months 25 days', null, 125, 125, 125, 'active', ''),
  ('40000000-0000-4000-8000-000000000016', 'TN-016', '20000000-0000-4000-8000-000000000016', '30000000-0000-4000-8000-000000020205', '10000000-0000-4000-8000-000000000002', current_date - interval '9 months 28 days', null, 150, 150, 150, 'active', '')
on conflict do nothing;

-- Utility rates -------------------------------------------------------------
insert into public.utility_rates (location_id, utility, rate, effective_from, notes) values
  ('10000000-0000-4000-8000-000000000001', 'electricity', 0.25, current_date - interval '2 years', 'អត្រាអគ្គិសនីស្តង់ដារ'),
  ('10000000-0000-4000-8000-000000000001', 'water',       0.50, current_date - interval '2 years', 'អត្រាទឹកស្តង់ដារ'),
  ('10000000-0000-4000-8000-000000000002', 'electricity', 0.25, current_date - interval '2 years', 'អត្រាអគ្គិសនីស្តង់ដារ'),
  ('10000000-0000-4000-8000-000000000002', 'water',       0.50, current_date - interval '2 years', 'អត្រាទឹកស្តង់ដារ')
on conflict do nothing;

-- Meters --------------------------------------------------------------------
insert into public.meters (
  location_id, room_id, utility, meter_number, allocation_method, initial_reading, installed_on
)
select
  r.location_id,
  r.id,
  u.utility,
  case u.utility when 'electricity' then 'E-' else 'W-' end
    || case when r.location_id = '10000000-0000-4000-8000-000000000001' then 'A' else 'B' end
    || r.room_number || '-01',
  'individual',
  case u.utility when 'electricity' then 1000 + (r.sort_order * 137) else 60 + (r.sort_order * 11) end,
  current_date - interval '2 years'
from public.rooms r
cross join (values ('electricity'::public.utility_type), ('water'::public.utility_type)) as u(utility)
on conflict do nothing;

commit;

-- Quick sanity output when run with psql:
-- select * from public.v_location_snapshot order by name_km;
-- select * from public.v_room_occupancy order by location_id, room_number;
