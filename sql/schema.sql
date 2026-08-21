-- ============================================================
-- Pool: shared daily-allowance tracker
-- Run this once in the Supabase SQL editor.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------

create table if not exists pools (
  id                uuid primary key default gen_random_uuid(),
  name              text        not null default 'Our pool',
  income            bigint      not null,
  savings_target    bigint      not null default 0,
  savings_balance   bigint      not null default 0,
  start_month       text        not null,               -- 'YYYY-MM'
  tz                text        not null default 'Asia/Ho_Chi_Minh',
  notify_threshold  bigint      not null default 500000, -- tell the other person above this
  created_at        timestamptz not null default now()
);

create table if not exists pool_members (
  pool_id           uuid    not null references pools(id) on delete cascade,
  telegram_chat_id  bigint  primary key,
  display_name      text    not null,
  created_at        timestamptz not null default now()
);
create index if not exists pool_members_pool_idx on pool_members(pool_id);

create table if not exists locked_bills (
  id        uuid    primary key default gen_random_uuid(),
  pool_id   uuid    not null references pools(id) on delete cascade,
  name      text    not null,
  amount    bigint  not null check (amount > 0),
  active    boolean not null default true
);
create index if not exists locked_bills_pool_idx on locked_bills(pool_id);

create table if not exists entries (
  id         uuid        primary key default gen_random_uuid(),
  pool_id    uuid        not null references pools(id) on delete cascade,
  spent_on   date        not null,
  amount     bigint      not null check (amount > 0),
  category   text        not null default 'others',
  note       text,
  snapshot   bigint      not null default 0,  -- daily number at the moment it was logged
  logged_by  bigint,                          -- telegram chat id, null if from the web app
  source     text        not null default 'bot',
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
create index if not exists savings_draws_pool_date_idx on savings_draws(pool_id, drawn_on);

create table if not exists cycles (
  pool_id   uuid  not null references pools(id) on delete cascade,
  cycle_key text  not null,                    -- 'YYYY-MM'
  swept     bigint not null default 0,
  closed_at timestamptz not null default now(),
  primary key (pool_id, cycle_key)
);

-- ------------------------------------------------------------
-- The single source of truth.
-- Both the bot and the web app call this. Never reimplement it.
-- ------------------------------------------------------------

create or replace function pool_state(p_pool uuid, p_ref date default null)
returns table (
  ref_date        date,
  tz              text,
  income          bigint,
  locked_total    bigint,
  savings_target  bigint,
  savings_balance bigint,
  pool_amount     bigint,
  spent           bigint,
  spent_today     bigint,
  drawn           bigint,
  available       bigint,
  per_day         bigint,
  days_in_month   int,
  days_left       int,
  elapsed         int,
  avg_per_day     bigint,
  big_days        int,
  under_days      int
)
language plpgsql
stable
as $$
declare
  v_tz      text;
  v_ref     date;
  v_start   date;
  v_end     date;
  v_income  bigint;
  v_target  bigint;
  v_balance bigint;
  v_locked  bigint;
  v_pool    bigint;
  v_spent   bigint;
  v_today   bigint;
  v_drawn   bigint;
  v_avail   bigint;
  v_days    int;
  v_left    int;
  v_maxday  int;
  v_elapsed int;
  v_big     int;
  v_under   int;
begin
  select p.tz, p.income, p.savings_target, p.savings_balance
    into v_tz, v_income, v_target, v_balance
  from pools p where p.id = p_pool;

  if v_tz is null then
    raise exception 'pool % not found', p_pool;
  end if;

  v_ref   := coalesce(p_ref, (now() at time zone v_tz)::date);
  v_start := date_trunc('month', v_ref)::date;
  v_end   := (v_start + interval '1 month' - interval '1 day')::date;
  v_days  := extract(day from v_end)::int;
  v_left  := v_days - extract(day from v_ref)::int + 1;

  select coalesce(sum(b.amount), 0) into v_locked
  from locked_bills b where b.pool_id = p_pool and b.active;

  v_pool := v_income - v_locked - v_target;

  select coalesce(sum(e.amount), 0) into v_spent
  from entries e
  where e.pool_id = p_pool and e.spent_on between v_start and v_end;

  select coalesce(sum(e.amount), 0) into v_today
  from entries e
  where e.pool_id = p_pool and e.spent_on = v_ref;

  select coalesce(sum(d.amount), 0) into v_drawn
  from savings_draws d
  where d.pool_id = p_pool and d.drawn_on between v_start and v_end;

  v_avail := v_pool + v_drawn - v_spent;

  -- day-level rollup, used for the average divisor and the big/under counts
  with per_day_totals as (
    select e.spent_on,
           sum(e.amount) as total,
           -- the number as it stood when the day's first entry was logged;
           -- later entries see a lower number, so min()/max() would both lie
           (array_agg(e.snapshot order by e.created_at asc))[1] as snap
    from entries e
    where e.pool_id = p_pool and e.spent_on between v_start and v_end
    group by e.spent_on
  )
  select coalesce(max(extract(day from spent_on)::int), 0),
         count(*) filter (where total >  snap)::int,
         count(*) filter (where total <= snap)::int
    into v_maxday, v_big, v_under
  from per_day_totals;

  v_elapsed := greatest(v_maxday, extract(day from v_ref)::int - 1);

  return query select
    v_ref,
    v_tz,
    v_income,
    v_locked,
    v_target,
    v_balance,
    v_pool,
    v_spent,
    v_today,
    v_drawn,
    v_avail,
    greatest(0, (v_avail / greatest(v_left, 1)))::bigint,
    v_days,
    v_left,
    v_elapsed,
    (case when v_elapsed > 0 then v_spent / v_elapsed else 0 end)::bigint,
    coalesce(v_big, 0),
    coalesce(v_under, 0);
end;
$$;

-- Category totals for the month, used by the `month` command.
create or replace function pool_breakdown(p_pool uuid, p_ref date default null)
returns table (category text, total bigint, entries int)
language plpgsql
stable
as $$
declare
  v_tz text; v_ref date; v_start date; v_end date;
begin
  select p.tz into v_tz from pools p where p.id = p_pool;
  v_ref   := coalesce(p_ref, (now() at time zone v_tz)::date);
  v_start := date_trunc('month', v_ref)::date;
  v_end   := (v_start + interval '1 month' - interval '1 day')::date;

  return query
    select e.category, sum(e.amount)::bigint, count(*)::int
    from entries e
    where e.pool_id = p_pool and e.spent_on between v_start and v_end
    group by e.category
    order by 2 desc;
end;
$$;

-- ------------------------------------------------------------
-- Row level security
--
-- Everything is denied by default. The bot and cron use the
-- service role key, which bypasses RLS entirely.
-- When you migrate the web app, add policies here.
-- ------------------------------------------------------------

alter table pools         enable row level security;
alter table pool_members  enable row level security;
alter table locked_bills  enable row level security;
alter table entries       enable row level security;
alter table savings_draws enable row level security;
alter table cycles        enable row level security;
