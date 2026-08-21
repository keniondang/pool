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

/** A first-time visitor has no link to open, so mint one. Without this
 *  the pool insert carries a null token and RLS refuses it, which looks
 *  from the outside like a dead Start button. */
export function ensureToken() {
  let t = poolToken();
  if (t) return t;
  const bytes = new Uint8Array(24);
  (crypto || window.crypto).getRandomValues(bytes);
  t = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
  return t;
}

/** The link to open on the other phone. The token in it is the password. */
export function shareLink() {
  return location.origin + location.pathname + '?k=' + (poolToken() || '');
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

  const [bills, entries, draws, cycles, states] = await Promise.all([
    req('locked_bills?select=*&pool_id=eq.' + p.id + '&active=is.true'),
    req('entries?select=*&pool_id=eq.' + p.id + '&order=created_at.asc'),
    req('savings_draws?select=*&pool_id=eq.' + p.id),
    req('cycles?select=cycle_key&pool_id=eq.' + p.id),
    req('month_state?select=*&pool_id=eq.' + p.id)
  ]);

  const config = {
    poolId: p.id,
    income: Number(p.income),
    savingsTarget: Number(p.savings_target),
    startMonth: p.start_month,
    lockedBills: (bills || []).map(b => ({
      id: b.id, name: b.name, amount: Number(b.amount), times: Number(b.times || 1)
    })),
    planned: p.planned || [],
    wishlist: p.wishlist || [],
    // one source per salary; falls back to the old single income field
    incomeSources: (p.income_sources && p.income_sources.length)
      ? p.income_sources.map(x => ({ id: x.id, name: x.name, amount: Number(x.amount) }))
      : [{ id: 'src-1', name: 'Salary', amount: Number(p.income) }]
  };

  const meta = {
    savingsBalance: Number(p.savings_balance),
    lastAmounts: p.last_amounts || {},
    closed: (cycles || []).map(c => c.cycle_key)
  };

  const months = {};
  const bucket = k => (months[k] = months[k] || { entries: [], draws: [] });

  const monthStates = {};
  (states || []).forEach(st => {
    monthStates[st.cycle_key] = {
      balanceOverride: st.balance_override === null ? null : Number(st.balance_override),
      savingsOverride: st.savings_override === null ? null : Number(st.savings_override),
      incomeReceived: st.income_received || {},
      billsPaid: st.bills_paid || {},
      savingsDone: !!st.savings_done,
      incomeEarly: st.income_early || {},
      startDay: Number(st.start_day || 1)
    };
  });

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

  return { config, meta, months, monthStates };
}

// ---------------------------------------------------------------- write

export async function saveConfig(config) {
  const sources = config.incomeSources || [];
  await req('pools?id=eq.' + config.poolId, {
    method: 'PATCH',
    body: {
      income: sources.reduce((s, x) => s + x.amount, 0),
      income_sources: sources,
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
        pool_id: config.poolId, name: b.name, amount: b.amount, times: b.times || 1
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

/** Deletes the pool. Everything else cascades. boot() then finds no pool
 *  and drops into the wizard, which is what erase is supposed to do. */
export async function deletePool(poolId) {
  await req('pools?id=eq.' + poolId, { method: 'DELETE' });
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
      access_token: ensureToken()
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

export async function saveMonthState(poolId, cycleKey, st) {
  await req('month_state', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: {
      pool_id: poolId,
      cycle_key: cycleKey,
      balance_override: st.balanceOverride,
      savings_override: st.savingsOverride,
      income_received: st.incomeReceived || {},
      bills_paid: st.billsPaid || {},
      savings_done: !!st.savingsDone,
      income_early: st.incomeEarly || {},
      start_day: st.startDay || 1,
      updated_at: new Date().toISOString()
    }
  });
}
