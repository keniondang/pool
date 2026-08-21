-- ============================================================
-- One-time seed. Edit the numbers and chat ids, then run.
-- ============================================================

with new_pool as (
  insert into pools (name, income, savings_target, savings_balance, start_month, tz, notify_threshold)
  values ('Keni + gf', 24500000, 6000000, 0, '2026-08', 'Asia/Ho_Chi_Minh', 500000)
  returning id
)
insert into locked_bills (pool_id, name, amount)
select id, name, amount from new_pool, (values
  ('Rent and utilities', 5000000),
  ('Fuel',                840000),
  ('Formal dates',       1200000),
  ('Parking',             450000),
  ('Haircut',             180000),
  ('Data',                125000)
) as b(name, amount);

-- Get the pool id, then add both chat ids.
-- Run scripts/get_chat_id.py to find them.
--
--   insert into pool_members (pool_id, telegram_chat_id, display_name)
--   values
--     ('<pool-uuid>', 123456789, 'Keni'),
--     ('<pool-uuid>', 987654321, 'Gf');

select id as pool_id, name from pools;
