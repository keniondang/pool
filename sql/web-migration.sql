-- ============================================================
-- Web app migration.
--
-- Safe to run whether or not you already ran the bot's schema.sql.
-- Everything here is idempotent.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Tables (skipped if the bot schema already created them)
-- ------------------------------------------------------------

create table if not exists pools (
  id                uuid primary key default gen_random_uuid(),
  name              text        not null default 'Our pool',
  income            bigint      not null,
  savings_target    bigint      not null default 0,
  savings_balance   bigint      not null default 0,
  start_month       text        not null,
  tz                text        not null default 'Asia/Ho_Chi_Minh',
  notify_threshold  bigint      not null default 500000,
  created_at        timestamptz not null default now()
);

create table if not exists locked_bills (
  id        uuid    primary key default gen_random_uuid(),
  pool_id   uuid    not null references pools(id) on delete cascade,
  name      text    not null,
  amount    bigint  not null check (amount > 0),
  active    boolean not null default true
);

create table if not exists entries (
  id         uuid        primary key default gen_random_uuid(),
  pool_id    uuid        not null references pools(id) on delete cascade,
  spent_on   date        not null,
  amount     bigint      not null check (amount > 0),
  category   text        not null default 'others',
  note       text,
  snapshot   bigint      not null default 0,
  logged_by  bigint,
  source     text        not null default 'web',
  created_at timestamptz not null default now()
);
create index if not exists entries_pool_date_idx on entries(pool_id, spent_on);

create table if not exists savings_draws (
  id         uuid        primary key default gen_random_uuid(),
  pool_id    uuid        not null references pools(id) on delete cascade,
  drawn_on   date        not null,
  amount     bigint      not null check (amount > 0),
  logged_by  bigint,
  created_at timestamptz not null default now()
);

create table if not exists cycles (
  pool_id   uuid   not null references pools(id) on delete cascade,
  cycle_key text   not null,
  swept     bigint not null default 0,
  closed_at timestamptz not null default now(),
  primary key (pool_id, cycle_key)
);

-- ------------------------------------------------------------
-- New columns the web app needs
-- ------------------------------------------------------------

alter table pools add column if not exists access_token text;
alter table pools add column if not exists planned      jsonb not null default '[]'::jsonb;
alter table pools add column if not exists wishlist     jsonb not null default '[]'::jsonb;
alter table pools add column if not exists last_amounts jsonb not null default '{}'::jsonb;

-- entries need a stable client id so the browser can delete what it created
alter table entries       add column if not exists client_id text;
alter table savings_draws add column if not exists client_id text;

create unique index if not exists pools_access_token_idx
  on pools(access_token) where access_token is not null;
create unique index if not exists entries_client_idx
  on entries(pool_id, client_id) where client_id is not null;

-- ------------------------------------------------------------
-- Access control
--
-- The browser sends its pool token in an x-pool-token header on every
-- request. This function turns that into a pool id. It is security
-- definer so it can read pools while RLS is switched on for pools.
-- ------------------------------------------------------------

create or replace function current_pool()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from pools p
  where p.access_token = nullif(
    current_setting('request.headers', true)::json ->> 'x-pool-token', ''
  )
  limit 1
$$;

alter table pools         enable row level security;
alter table locked_bills  enable row level security;
alter table entries       enable row level security;
alter table savings_draws enable row level security;
alter table cycles        enable row level security;

drop policy if exists web_pools         on pools;
drop policy if exists web_locked_bills  on locked_bills;
drop policy if exists web_entries       on entries;
drop policy if exists web_savings_draws on savings_draws;
drop policy if exists web_cycles        on cycles;

create policy web_pools on pools
  for all to anon, authenticated
  using (id = current_pool())
  with check (id = current_pool());

create policy web_locked_bills on locked_bills
  for all to anon, authenticated
  using (pool_id = current_pool())
  with check (pool_id = current_pool());

create policy web_entries on entries
  for all to anon, authenticated
  using (pool_id = current_pool())
  with check (pool_id = current_pool());

create policy web_savings_draws on savings_draws
  for all to anon, authenticated
  using (pool_id = current_pool())
  with check (pool_id = current_pool());

create policy web_cycles on cycles
  for all to anon, authenticated
  using (pool_id = current_pool())
  with check (pool_id = current_pool());

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete
  on pools, locked_bills, entries, savings_draws, cycles
  to anon, authenticated;

-- ------------------------------------------------------------
-- Create your pool. Edit the numbers, then run.
--
-- Only run this block ONCE. If you already created a pool with the
-- bot's seed.sql, skip it and just run the update at the bottom.
-- ------------------------------------------------------------

-- insert into pools (name, income, savings_target, start_month, tz, access_token)
-- values ('Keni + gf', 24500000, 6000000, '2026-08', 'Asia/Ho_Chi_Minh',
--         encode(gen_random_bytes(24), 'hex'));

-- insert into locked_bills (pool_id, name, amount)
-- select p.id, b.name, b.amount
-- from pools p, (values
--   ('Rent and utilities', 5000000),
--   ('Fuel',                840000),
--   ('Formal dates',       1200000),
--   ('Parking',             450000),
--   ('Haircut',             180000),
--   ('Data',                125000)
-- ) as b(name, amount)
-- where p.name = 'Keni + gf';

-- If the pool already exists but has no token yet:
update pools
set access_token = encode(gen_random_bytes(24), 'hex')
where access_token is null;

-- ------------------------------------------------------------
-- This prints the link to open on both phones. Keep it private:
-- the token in it is the password.
-- ------------------------------------------------------------

select name,
       id as pool_id,
       access_token,
       'https://YOUR-APP.vercel.app/?k=' || access_token as open_this_link
from pools;
