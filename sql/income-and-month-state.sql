-- ============================================================
-- Income sources + per-month state
-- Run after web-migration.sql. Idempotent.
-- ============================================================

-- Income becomes a list, so two salaries (or a bonus, or freelance work)
-- fit without a schema change. The `income` column stays as the sum for
-- anything still reading it.
alter table pools add column if not exists income_sources jsonb not null default '[]'::jsonb;

-- Everything that resets each month lives here rather than on pools,
-- so August's state does not leak into September.
create table if not exists month_state (
  pool_id          uuid    not null references pools(id) on delete cascade,
  cycle_key        text    not null,                    -- 'YYYY-MM'
  balance_override bigint,                              -- null = derive from income
  savings_override bigint,                              -- null = use the pool's target
  income_received  jsonb   not null default '{}'::jsonb, -- { sourceId: false } when NOT yet in
  bills_paid       jsonb   not null default '{}'::jsonb, -- { billId: true } once paid
  updated_at       timestamptz not null default now(),
  primary key (pool_id, cycle_key)
);

alter table month_state enable row level security;

drop policy if exists web_month_state on month_state;
create policy web_month_state on month_state
  for all to anon, authenticated
  using (pool_id = current_pool())
  with check (pool_id = current_pool());

grant select, insert, update, delete on month_state to anon, authenticated;

-- Bills need stable ids so the paid flags survive an edit.
-- They already have uuid primary keys, nothing to do.

-- ------------------------------------------------------------
-- One-time: turn your existing single income into one source.
-- Safe to run more than once.
-- ------------------------------------------------------------
update pools
set income_sources = jsonb_build_array(
      jsonb_build_object('id', 'src-1', 'name', 'Salary', 'amount', income)
    )
where income_sources = '[]'::jsonb;

select name, income, income_sources from pools;
