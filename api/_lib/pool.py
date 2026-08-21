"""
Shared logic for the Pool Telegram bot.

Deliberately stdlib only: no requirements.txt, nothing to install,
no dependency resolution on cold start.

The daily-number calculation is NOT here. It lives in the
pool_state() Postgres function so the bot and the web app can never
drift apart. This module only calls it.
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime
from zoneinfo import ZoneInfo

# ---------------------------------------------------------------- config

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
WEBHOOK_SECRET = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
CRON_SECRET = os.environ.get("CRON_SECRET", "")

TG_API = "https://api.telegram.org/bot{}/{}".format

CATEGORIES = ["foods", "groceries", "shopping", "parking", "fuel", "others"]
CAT_EMOJI = {
    "foods": "🍜",
    "groceries": "🛒",
    "shopping": "🛍",
    "parking": "🅿️",
    "fuel": "⛽",
    "others": "•",
}


class PoolError(Exception):
    """Something the user should be told about, in plain language."""


# ---------------------------------------------------------------- http

def _request(url, method="GET", body=None, headers=None, timeout=15):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:400]
        raise PoolError(f"{method} {url.split('?')[0]} failed ({e.code}): {detail}")


def _sb_headers(extra=None):
    h = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    h.update(extra or {})
    return h


def sb_select(table, params):
    q = urllib.parse.urlencode(params, safe="*.,()")
    return _request(f"{SUPABASE_URL}/rest/v1/{table}?{q}", headers=_sb_headers()) or []


def sb_insert(table, row):
    out = _request(
        f"{SUPABASE_URL}/rest/v1/{table}",
        method="POST",
        body=row,
        headers=_sb_headers({"Prefer": "return=representation"}),
    )
    return out[0] if out else None


def sb_delete(table, params):
    q = urllib.parse.urlencode(params, safe="*.,()")
    return _request(
        f"{SUPABASE_URL}/rest/v1/{table}?{q}", method="DELETE", headers=_sb_headers()
    )


def sb_rpc(fn, payload):
    return _request(
        f"{SUPABASE_URL}/rest/v1/rpc/{fn}",
        method="POST",
        body=payload,
        headers=_sb_headers(),
    )


# ---------------------------------------------------------------- telegram

def tg(method, payload):
    return _request(TG_API(BOT_TOKEN, method), method="POST", body=payload)


def send(chat_id, text, keyboard=None):
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if keyboard:
        payload["reply_markup"] = {"inline_keyboard": keyboard}
    return tg("sendMessage", payload)


def answer_callback(callback_id, text=None):
    payload = {"callback_query_id": callback_id}
    if text:
        payload["text"] = text
    return tg("answerCallbackQuery", payload)


def edit_text(chat_id, message_id, text):
    return tg(
        "editMessageText",
        {
            "chat_id": chat_id,
            "message_id": message_id,
            "text": text,
            "parse_mode": "HTML",
        },
    )


# ---------------------------------------------------------------- formatting

def vnd(n):
    """1234567 -> '1.234.567'"""
    return f"{int(round(n)):,}".replace(",", ".")


def short(n):
    n = int(round(n))
    if n >= 1_000_000:
        v = n / 1_000_000
        return (f"{v:.1f}".rstrip("0").rstrip(".")) + "m"
    if n >= 1000:
        return f"{round(n / 1000)}k"
    return str(n)


# ---------------------------------------------------------------- parsing

_AMOUNT_RE = re.compile(r"^([\d.,]+)\s*(k|rb|m|tr|tri[eệ]u)?$", re.IGNORECASE)


def parse_amount(token):
    """
    '45k' -> 45000      '1.5k' -> 1500     '45000' -> 45000
    '45.000' -> 45000   '2tr' -> 2000000   '1m' -> 1000000
    Returns None if it isn't an amount.
    """
    token = token.strip().lower()
    m = _AMOUNT_RE.match(token)
    if not m:
        return None
    num, suffix = m.group(1), m.group(2)

    if suffix:
        # suffix present, so separators are decimal points: 1.5k, 1,5k
        num = num.replace(",", ".")
        if num.count(".") > 1:
            return None
        try:
            value = float(num)
        except ValueError:
            return None
        mult = 1000 if suffix in ("k", "rb") else 1_000_000
        return int(round(value * mult))

    # no suffix, so separators are thousands grouping: 45.000 / 45,000
    digits = re.sub(r"[.,]", "", num)
    if not digits.isdigit():
        return None
    return int(digits)


def category_hits(token):
    """All categories a token could mean. 'fo' -> [foods], 'f' -> [foods, fuel]."""
    if not token:
        return []
    t = token.strip().lower()
    if t in CATEGORIES:
        return [t]
    return [c for c in CATEGORIES if c.startswith(t)]


def match_category(token):
    """Exactly one match, or None. 'fo' -> foods, 'f' -> None (foods vs fuel)."""
    hits = category_hits(token)
    return hits[0] if len(hits) == 1 else None


def parse_message(text):
    """
    Returns (command, args) where command is one of:
    log, today, status, month, undo, help
    """
    text = (text or "").strip()
    if not text:
        return ("help", {})

    parts = text.split()
    head = parts[0].lower().lstrip("/")
    # strip Telegram's @botname suffix on commands
    head = head.split("@")[0]

    if head in ("today", "status", "month", "undo", "help", "start"):
        return ("help" if head == "start" else head, {})

    # 'log 45k foods lunch' or bare '45k foods lunch'
    rest = parts[1:] if head == "log" else parts
    if not rest:
        return ("help", {})

    amount = parse_amount(rest[0])
    if amount is None or amount <= 0:
        return ("help", {})

    category = None
    note_from = 1
    if len(rest) > 1:
        hits = category_hits(rest[1])
        if len(hits) == 1:
            category = hits[0]
            note_from = 2
        elif len(hits) > 1:
            # ambiguous, e.g. 'f' could be foods or fuel. Consume the token
            # anyway so it does not pollute the note, and let the buttons decide.
            note_from = 2

    note = " ".join(rest[note_from:]).strip() or None
    return ("log", {"amount": amount, "category": category, "note": note})


# ---------------------------------------------------------------- data access

def get_member(chat_id):
    rows = sb_select(
        "pool_members",
        {"select": "pool_id,display_name,telegram_chat_id", "telegram_chat_id": f"eq.{chat_id}"},
    )
    if not rows:
        raise PoolError("unregistered")
    return rows[0]


def get_pool(pool_id):
    rows = sb_select("pools", {"select": "*", "id": f"eq.{pool_id}"})
    if not rows:
        raise PoolError("pool not found")
    return rows[0]


def members_of(pool_id):
    return sb_select(
        "pool_members",
        {"select": "telegram_chat_id,display_name", "pool_id": f"eq.{pool_id}"},
    )


def state(pool_id, ref=None):
    rows = sb_rpc("pool_state", {"p_pool": pool_id, "p_ref": ref})
    if not rows:
        raise PoolError("could not compute pool state")
    return rows[0]


def breakdown(pool_id, ref=None):
    return sb_rpc("pool_breakdown", {"p_pool": pool_id, "p_ref": ref}) or []


def today_in(tz):
    return datetime.now(ZoneInfo(tz)).date().isoformat()


def entries_on(pool_id, day):
    return sb_select(
        "entries",
        {
            "select": "id,amount,category,note,logged_by,created_at",
            "pool_id": f"eq.{pool_id}",
            "spent_on": f"eq.{day}",
            "order": "created_at.asc",
        },
    )


def add_entry(pool_id, chat_id, amount, category, note, ref=None):
    """Snapshot the daily number BEFORE inserting, so big-day colouring stays honest."""
    st = state(pool_id, ref)
    day = ref or st["ref_date"]
    sb_insert(
        "entries",
        {
            "pool_id": pool_id,
            "spent_on": day,
            "amount": amount,
            "category": category,
            "note": note,
            "snapshot": st["per_day"],
            "logged_by": chat_id,
            "source": "bot",
        },
    )
    return state(pool_id, ref)


def undo_last(pool_id, chat_id):
    rows = sb_select(
        "entries",
        {
            "select": "id,amount,category,note,spent_on",
            "pool_id": f"eq.{pool_id}",
            "logged_by": f"eq.{chat_id}",
            "order": "created_at.desc",
            "limit": "1",
        },
    )
    if not rows:
        return None
    sb_delete("entries", {"id": f"eq.{rows[0]['id']}"})
    return rows[0]


# ---------------------------------------------------------------- messages

def line_number(st):
    return f"<b>{vnd(st['per_day'])}</b> per day · {st['days_left']} days left"


def msg_logged(amount, category, st):
    emoji = CAT_EMOJI.get(category, "•")
    left = st["per_day"] - st["spent_today"]
    tail = (
        f"{vnd(left)} left today"
        if left > 0
        else f"over today by {vnd(abs(left))}"
    )
    return (
        f"{emoji} Logged <b>{vnd(amount)}</b> · {category}\n"
        f"{line_number(st)}\n"
        f"<i>{vnd(st['spent_today'])} spent today, {tail}</i>"
    )


def msg_today(pool_id, st, rows):
    if not rows:
        body = "<i>Nothing logged yet today.</i>"
    else:
        body = "\n".join(
            f"{CAT_EMOJI.get(r['category'], '•')} {vnd(r['amount'])}"
            + (f" · {r['note']}" if r.get("note") else "")
            for r in rows
        )
    left = st["per_day"] - st["spent_today"]
    tail = f"{vnd(left)} left" if left > 0 else f"over by {vnd(abs(left))}"
    return (
        f"<b>Today</b> · {st['ref_date']}\n\n"
        f"{body}\n\n"
        f"Spent {vnd(st['spent_today'])} of {vnd(st['per_day'])} · {tail}"
    )


def msg_status(st):
    return (
        f"💰 <b>{vnd(st['per_day'])}</b> safe to spend today\n\n"
        f"Pool left      {vnd(st['available'])}\n"
        f"Spent so far   {vnd(st['spent'])}\n"
        f"Daily average  {vnd(st['avg_per_day'])}\n"
        f"Days left      {st['days_left']} of {st['days_in_month']}\n\n"
        f"🔒 Locked bills  {vnd(st['locked_total'])}\n"
        f"🛡 Savings       {vnd(st['savings_balance'])}"
        + (f"\n⚠️ Drawn this month {vnd(st['drawn'])}" if st["drawn"] else "")
    )


def msg_month(st, rows):
    if not rows:
        return "Nothing logged this month yet."
    total = sum(r["total"] for r in rows)
    lines = []
    for r in rows:
        pct = round(r["total"] / total * 100) if total else 0
        bar = "█" * max(1, round(pct / 10))
        lines.append(
            f"{CAT_EMOJI.get(r['category'], '•')} {r['category']:<10} "
            f"{vnd(r['total']):>11}  {bar} {pct}%"
        )
    def plural(n, word):
        return f"{n} {word}" + ("" if n == 1 else "s")

    return (
        f"<b>This month</b>\n<pre>" + "\n".join(lines) + "</pre>\n"
        f"Total {vnd(total)} · avg {vnd(st['avg_per_day'])}/day\n"
        f"{plural(st['under_days'], 'under day')} · {plural(st['big_days'], 'big day')}"
    )


def msg_help():
    return (
        "<b>Pool</b>\n\n"
        "<code>45k foods</code>  log a spend\n"
        "<code>log 45k</code>  log, then pick a category\n"
        "<code>120k groceries weekly run</code>  with a note\n\n"
        "<code>today</code>  what you spent today\n"
        "<code>status</code>  daily number and pool\n"
        "<code>month</code>  category breakdown\n"
        "<code>undo</code>  remove your last entry\n\n"
        "Amounts: <code>45k</code>, <code>45000</code>, <code>45.000</code>, "
        "<code>1.5k</code>, <code>2tr</code>\n"
        "Categories: " + ", ".join(CATEGORIES)
    )


def category_keyboard(amount, note=None):
    """Inline buttons shown when the category is missing."""
    tag = f"|{note}" if note else ""
    rows, row = [], []
    for i, c in enumerate(CATEGORIES):
        row.append(
            {
                "text": f"{CAT_EMOJI[c]} {c}",
                "callback_data": f"c|{amount}|{c}{tag}"[:64],
            }
        )
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    return rows


def notify_partner(pool_id, actor_chat_id, actor_name, amount, category, st):
    """Tell the other member about a large spend, so nothing is a surprise later."""
    pool = get_pool(pool_id)
    threshold = pool.get("notify_threshold") or 0
    if not threshold or amount < threshold:
        return
    for m in members_of(pool_id):
        if int(m["telegram_chat_id"]) == int(actor_chat_id):
            continue
        send(
            m["telegram_chat_id"],
            f"👀 {actor_name} logged <b>{vnd(amount)}</b> · {category}\n"
            f"{line_number(st)}",
        )
