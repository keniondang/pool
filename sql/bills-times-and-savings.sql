-- ============================================================
-- Bill frequency, savings confirmation, early income
-- Run after the earlier migrations. Idempotent.
-- ============================================================

-- A haircut is 180.000 twice a month. Predictable, so it belongs in
-- bills, but the amount is per occurrence.
alter table locked_bills add column if not exists times int not null default 1;

-- Did the money actually move? A savings balance that grows whether or
-- not you transferred anything is fiction.
alter table month_state add column if not exists savings_done boolean not null default false;

-- Salary that lands before the month it belongs to.
alter table month_state add column if not exists income_early jsonb not null default '{}'::jsonb;

select 'bills.times, month_state.savings_done, month_state.income_early added' as done;
