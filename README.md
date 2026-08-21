# Pool bot

Telegram bot for the shared daily-allowance tracker. Both of you message the
same bot, both write to the same pool.

```
you  ──▶ Telegram ──▶ Vercel /api/telegram ──▶ Supabase
                                                  ▲
GitHub Actions (8am / 9pm) ──▶ scripts/run_job ───┘
```

## The one rule

`calc()` is not implemented here. It lives in the `pool_state()` Postgres
function. The bot and the web app both call it, so they cannot drift apart.
If you need to change how the daily number works, change the SQL, not Python.

## Layout

```
sql/schema.sql          tables, pool_state(), pool_breakdown(), RLS
sql/seed.sql            create your pool and locked bills
api/telegram.py         webhook: parse, dispatch, reply
api/cron.py             manual trigger for the scheduled jobs
api/_lib/pool.py        supabase access, parsing, formatting, telegram send
api/_lib/jobs.py        morning brief, evening reminder, month close
scripts/get_chat_id.py  find your chat ids
scripts/set_webhook.py  point the bot at your deployment
scripts/run_job.py      what GitHub Actions runs
.github/workflows/      two schedules
```

No dependencies. Standard library only, so there is no `requirements.txt`
and nothing to install on cold start.

## Setup

**1. Database**

In the Supabase SQL editor, run `sql/schema.sql`, then edit and run
`sql/seed.sql`. Copy the `pool_id` it prints.

**2. Bot**

Message [@BotFather](https://t.me/BotFather), send `/newbot`, keep the token.

Both of you send the new bot any message. Then:

```bash
TELEGRAM_BOT_TOKEN=... python scripts/get_chat_id.py
```

Add both ids to `pool_members` with the `pool_id` from step 1:

```sql
insert into pool_members (pool_id, telegram_chat_id, display_name)
values ('<pool-uuid>', 111111111, 'Keni'),
       ('<pool-uuid>', 222222222, 'Gf');
```

Run `get_chat_id.py` *before* setting the webhook. Telegram stops serving
`getUpdates` once a webhook exists.

**3. Deploy**

Push to GitHub, import into Vercel. Set these environment variables:

| Variable | Where from |
|---|---|
| `SUPABASE_URL` | Supabase → Project settings → API |
| `SUPABASE_SERVICE_KEY` | same page, the **service_role** key |
| `TELEGRAM_BOT_TOKEN` | BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | any random string you invent |
| `CRON_SECRET` | another random string |

The service_role key bypasses RLS. It belongs on the server only, never in
the browser.

**4. Register the webhook**

```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
  python scripts/set_webhook.py https://your-app.vercel.app/api/telegram
```

Send `status` to the bot. If you get a number back, it works.

**5. Schedules**

In the GitHub repo, add secrets `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and
`TELEGRAM_BOT_TOKEN`. The two workflows run at 01:00 and 14:00 UTC, which is
8am and 9pm in Ho Chi Minh City.

GitHub delays scheduled runs under load, sometimes by 15 to 30 minutes. The
messages deliberately contain no clock time so you will not notice. If you
ever need it exact, use `pg_cron` in Supabase to hit `/api/cron` instead.

Use **Actions → Run workflow** to fire either one by hand and confirm it works
before waiting a day.

## Commands

| Send | Get |
|---|---|
| `45k foods` | logged, plus the new daily number |
| `log 45k foods pho` | same, with a note |
| `log 45k` | buttons to pick the category |
| `today` | today's entries and what is left |
| `status` | daily number, pool, savings |
| `month` | category breakdown, under and big days |
| `undo` | removes your last entry |

Amounts accept `45k`, `45000`, `45.000`, `1.5k`, `2tr`, `1m`.

Categories prefix-match, so `fo` is foods and `gro` is groceries. `f` is
ambiguous between foods and fuel, so it shows the buttons instead of guessing.

The `log` keyword is optional. `45k foods` on its own works.

## Behaviour worth knowing

**Snapshots.** Every entry stores the daily number as it stood when it was
logged. That is what makes big-day marking honest later. Backfilling an old
day will store today's number, so the colour for that day may be off.

**Month close.** The morning job sweeps a finished month's leftover into
savings and tells you both. It is idempotent, tracked in the `cycles` table,
so running it twice is harmless.

**Partner notice.** Spends at or above `pools.notify_threshold` (500.000 by
default) message the other person. Set it to 0 to switch this off.

**Timezone.** Everything derives from `pools.tz`. The Postgres function
computes today's date in that zone, so logging at 00:30 lands on the right day.

**Unregistered chats** get told their chat id and nothing else. No data leaks
to strangers who find the bot.

## Migrating the web app

`js/storage.js` is the only file that touches persistence, and `calc()` in
`js/data.js` becomes an RPC call to `pool_state`. Nothing else changes. Add
RLS policies before pointing a browser at Supabase, since RLS is currently
deny-all and only the service key gets through.
