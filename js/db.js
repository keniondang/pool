// The only file that talks to the database.
//
// Reads happen once on boot and hydrate S. Writes are incremental:
// adding one entry inserts one row rather than replacing the month, so
// two people logging at the same moment cannot overwrite each other.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const TOKEN_KEY = 'pool:token';

/**
 * The token arrives once as ?k=... in the link, then lives in this
 * browser and is stripped from the address bar so it is not sitting in
 * screenshots or shared URLs.
 */
export function poolToken() {
  try {
    const url = new URL(location.href);
    const k = url.searchParams.get('k');
    if (k) {
      localStorage.setItem(TOKEN_KEY, k);
      url.searchParams.delete('k');
      history.replaceState({}, '', url.pathname + url.search + url.hash);
      return k;
    }
    return localStorage.getItem(TOKEN_KEY);
  } catch (e) {
    return null;
  }
}

export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
}

function headers(extra) {
  return Object.assign({
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    'x-pool-token': poolToken() || '',
    'Content-Type': 'application/json'
  }, extra || {});
}

async function req(path, opts = {}) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: opts.method || 'GET',
    headers: headers(opts.headers),
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error('supabase ' + res.status + ': ' + detail.slice(0, 200));
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const cid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------------------------------------------------------------- read

/**
 * Pulls everything and shapes it exactly like the old localStorage
 * structure, so nothing downstream of this function had to change.
 */
export async function loadAll() {
  const pools = await req('pools?select=*&limit=1');
  if (!pools || !pools.length) return null;
  const p = pools[0];

  const [bills, entries, draws, cycles] = await Promise.all([
    req('locked_bills?select=*&pool_id=eq.' + p.id + '&active=is.true'),
    req('entries?select=*&pool_id=eq.' + p.id + '&order=created_at.asc'),
    req('savings_draws?select=*&pool_id=eq.' + p.id),
    req('cycles?select=cycle_key&pool_id=eq.' + p.id)
  ]);

  const config = {
    poolId: p.id,
    income: Number(p.income),
    savingsTarget: Number(p.savings_target),
    startMonth: p.start_month,
    lockedBills: (bills || []).map(b => ({
      id: b.id, name: b.name, amount: Number(b.amount)
    })),
    planned: p.planned || [],
    wishlist: p.wishlist || []
  };

  const meta = {
    savingsBalance: Number(p.savings_balance),
    lastAmounts: p.last_amounts || {},
    closed: (cycles || []).map(c => c.cycle_key)
  };

  const months = {};
  const bucket = k => (months[k] = months[k] || { entries: [], draws: [] });

  (entries || []).forEach(e => {
    bucket(e.spent_on.slice(0, 7)).entries.push({
      id: e.client_id || e.id,
      rowId: e.id,
      amount: Number(e.amount),
      cat: e.category,
      note: e.note,
      date: e.spent_on,
      snap: Number(e.snapshot)
    });
  });

  (draws || []).forEach(d => {
    bucket(d.drawn_on.slice(0, 7)).draws.push({
      id: d.client_id || d.id,
      rowId: d.id,
      amount: Number(d.amount),
      date: d.drawn_on
    });
  });

  return { config, meta, months };
}

// ---------------------------------------------------------------- write

export async function saveConfig(config) {
  await req('pools?id=eq.' + config.poolId, {
    method: 'PATCH',
    body: {
      income: config.income,
      savings_target: config.savingsTarget,
      planned: config.planned || [],
      wishlist: config.wishlist || []
    }
  });

  // Bills are few and change rarely, so replacing the set is fine here.
  await req('locked_bills?pool_id=eq.' + config.poolId, { method: 'DELETE' });
  if ((config.lockedBills || []).length) {
    await req('locked_bills', {
      method: 'POST',
      body: config.lockedBills.map(b => ({
        pool_id: config.poolId, name: b.name, amount: b.amount
      }))
    });
  }
}

export async function saveMeta(poolId, meta) {
  await req('pools?id=eq.' + poolId, {
    method: 'PATCH',
    body: {
      savings_balance: Math.round(meta.savingsBalance),
      last_amounts: meta.lastAmounts || {}
    }
  });
}

export async function addEntry(poolId, entry) {
  const clientId = entry.id || cid();
  const rows = await req('entries', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: {
      pool_id: poolId,
      spent_on: entry.date,
      amount: entry.amount,
      category: entry.cat || 'others',
      note: entry.note || null,
      snapshot: entry.snap || 0,
      client_id: clientId,
      source: 'web'
    }
  });
  return { clientId, rowId: rows && rows[0] ? rows[0].id : null };
}

export async function removeEntry(poolId, entry) {
  const filter = entry.rowId
    ? 'id=eq.' + entry.rowId
    : 'client_id=eq.' + encodeURIComponent(entry.id);
  await req('entries?pool_id=eq.' + poolId + '&' + filter, { method: 'DELETE' });
}

export async function addDraw(poolId, draw) {
  const clientId = draw.id || cid();
  const rows = await req('savings_draws', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: {
      pool_id: poolId,
      drawn_on: draw.date,
      amount: draw.amount,
      client_id: clientId
    }
  });
  return { clientId, rowId: rows && rows[0] ? rows[0].id : null };
}

export async function markCycleClosed(poolId, cycleKey, swept) {
  await req('cycles', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: { pool_id: poolId, cycle_key: cycleKey, swept: Math.round(swept) }
  });
}

/** Used by the first-run wizard, which creates the pool row itself. */
export async function createPool(cfg) {
  const rows = await req('pools', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: {
      name: cfg.name || 'Our pool',
      income: cfg.income,
      savings_target: cfg.savingsTarget,
      savings_balance: cfg.startingSavings || 0,
      start_month: cfg.startMonth,
      access_token: poolToken()
    }
  });
  return rows && rows[0] ? rows[0].id : null;
}

/** Everything the Backup button exports, and what Import pushes back. */
export async function pushSnapshot(config, meta, months) {
  await saveConfig(config);
  await saveMeta(config.poolId, meta);
  await req('entries?pool_id=eq.' + config.poolId, { method: 'DELETE' });
  await req('savings_draws?pool_id=eq.' + config.poolId, { method: 'DELETE' });

  const entries = [], draws = [];
  Object.keys(months).forEach(k => {
    (months[k].entries || []).forEach(e => entries.push({
      pool_id: config.poolId, spent_on: e.date, amount: e.amount,
      category: e.cat || 'others', note: e.note || null,
      snapshot: e.snap || 0, client_id: e.id || cid(), source: 'web'
    }));
    (months[k].draws || []).forEach(d => draws.push({
      pool_id: config.poolId, drawn_on: d.date, amount: d.amount,
      client_id: d.id || cid()
    }));
  });

  if (entries.length) await req('entries', { method: 'POST', body: entries });
  if (draws.length) await req('savings_draws', { method: 'POST', body: draws });
}
