"""
Scheduled messages. Called by GitHub Actions (scripts/run_job.py)
or manually via /api/cron?job=morning.
"""

from . import pool as P


def _pools():
    return P.sb_select("pools", {"select": "id,name,tz,notify_threshold"})


def morning(pool_id=None):
    """8am: what you can spend today, and where the month stands."""
    sent = []
    for pool in _pools():
        if pool_id and pool["id"] != pool_id:
            continue
        st = P.state(pool["id"])

        pace = ""
        if st["avg_per_day"] and st["elapsed"] > 0:
            projected = st["avg_per_day"] * st["days_in_month"]
            gap = projected - st["pool_amount"]
            if gap > 0:
                pace = f"\n\n📈 At your current pace you finish about {P.vnd(gap)} over."
            else:
                pace = (
                    f"\n\n📉 At your current pace you finish with about "
                    f"{P.vnd(abs(gap))} spare, which sweeps into savings."
                )

        text = (
            f"☀️ <b>{P.vnd(st['per_day'])}</b> to spend today\n\n"
            f"{st['days_left']} days left · {P.vnd(st['available'])} in the pool\n"
            f"Bills and savings are already covered."
            f"{pace}"
        )
        for m in P.members_of(pool["id"]):
            P.send(m["telegram_chat_id"], text)
            sent.append(m["telegram_chat_id"])
    return sent


def evening(pool_id=None):
    """9pm: nudge if nothing was logged, otherwise a short wrap."""
    sent = []
    for pool in _pools():
        if pool_id and pool["id"] != pool_id:
            continue
        st = P.state(pool["id"])
        rows = P.entries_on(pool["id"], st["ref_date"])

        if not rows:
            text = (
                "🌙 Nothing logged today.\n\n"
                "If you really spent nothing, ignore this. Otherwise send it now "
                "while you still remember, a blank day quietly inflates tomorrow's "
                "number.\n\n"
                "<code>45k foods</code>"
            )
        else:
            left = st["per_day"] - st["spent_today"]
            verdict = (
                f"✅ Under by {P.vnd(left)}, it rolls into the days ahead."
                if left >= 0
                else f"⚠️ Over by {P.vnd(abs(left))}, spread across {st['days_left'] - 1} remaining days."
            )
            tomorrow = st["available"] // max(1, st["days_left"] - 1)
            text = (
                f"🌙 <b>{P.vnd(st['spent_today'])}</b> spent today "
                f"of {P.vnd(st['per_day'])}\n\n"
                f"{verdict}\n"
                f"Tomorrow: around {P.vnd(tomorrow)}."
            )

        for m in P.members_of(pool["id"]):
            P.send(m["telegram_chat_id"], text)
            sent.append(m["telegram_chat_id"])
    return sent


def close_cycles():
    """
    Sweep finished months into the savings balance.
    Safe to run daily, it skips months already closed.
    """
    from datetime import date, timedelta

    closed = []
    for pool in _pools():
        st = P.state(pool["id"])
        cur_key = str(st["ref_date"])[:7]

        first_of_month = date.fromisoformat(str(st["ref_date"])).replace(day=1)
        prev = first_of_month - timedelta(days=1)
        prev_key = prev.isoformat()[:7]

        if prev_key == cur_key:
            continue

        already = P.sb_select(
            "cycles",
            {
                "select": "cycle_key",
                "pool_id": f"eq.{pool['id']}",
                "cycle_key": f"eq.{prev_key}",
            },
        )
        if already:
            continue

        prev_st = P.state(pool["id"], prev.isoformat())
        if prev_st["spent"] == 0 and prev_st["drawn"] == 0:
            continue

        swept = prev_st["savings_target"] - prev_st["drawn"] + prev_st["available"]
        full = P.get_pool(pool["id"])
        P._request(
            f"{P.SUPABASE_URL}/rest/v1/pools?id=eq.{pool['id']}",
            method="PATCH",
            body={"savings_balance": int(full["savings_balance"]) + int(swept)},
            headers=P._sb_headers(),
        )
        P.sb_insert(
            "cycles",
            {"pool_id": pool["id"], "cycle_key": prev_key, "swept": int(swept)},
        )
        closed.append((prev_key, swept))

        for m in P.members_of(pool["id"]):
            P.send(
                m["telegram_chat_id"],
                f"📦 <b>{prev_key} closed</b>\n\n"
                f"Swept into savings: {P.vnd(swept)}\n"
                f"New balance: {P.vnd(int(full['savings_balance']) + int(swept))}",
            )
    return closed
