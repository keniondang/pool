-- ============================================================
-- Lets a token with no pool create one.
--
-- The existing policy checks `id = current_pool()`, and current_pool()
-- looks the row up by access_token. During an INSERT that row does not
-- exist yet, so the check always failed. First run and post-erase both
-- hit this.
-- ============================================================

drop policy if exists web_pools on pools;

-- read / update / delete: only your own pool
create policy web_pools_rw on pools
  for select to anon, authenticated
  using (id = current_pool());

create policy web_pools_update on pools
  for update to anon, authenticated
  using (id = current_pool())
  with check (id = current_pool());

create policy web_pools_delete on pools
  for delete to anon, authenticated
  using (id = current_pool());

-- create: allowed only while your token does not already own a pool
create policy web_pools_insert on pools
  for insert to anon, authenticated
  with check (
    access_token is not null
    and access_token = nullif(
      current_setting('request.headers', true)::json ->> 'x-pool-token', ''
    )
    and current_pool() is null
  );

select 'pools policies updated' as done;
