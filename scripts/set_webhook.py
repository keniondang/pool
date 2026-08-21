#!/usr/bin/env python3
"""
Points your bot at the deployed webhook. Run once after deploying.

  TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
  python scripts/set_webhook.py https://your-app.vercel.app/api/telegram
"""

import json
import os
import sys
import urllib.parse
import urllib.request

token = os.environ.get("TELEGRAM_BOT_TOKEN")
secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
if not token:
    raise SystemExit("set TELEGRAM_BOT_TOKEN first")
if len(sys.argv) < 2:
    raise SystemExit("usage: set_webhook.py https://your-app.vercel.app/api/telegram")

params = {"url": sys.argv[1], "drop_pending_updates": "true"}
if secret:
    params["secret_token"] = secret

url = f"https://api.telegram.org/bot{token}/setWebhook?" + urllib.parse.urlencode(params)
with urllib.request.urlopen(url, timeout=15) as r:
    print(json.loads(r.read().decode()))
