-- ============================================================
-- Cycle start day. Idempotent.
--
-- Starting on the 21st means your month is 11 days long, not 31.
-- Without this the month bar, the pace figure and the daily average
-- all divide by the wrong number.
-- ============================================================

alter table month_state add column if not exists start_day int not null default 1;

select 'month_state.start_day added' as done;
