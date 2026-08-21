#!/usr/bin/env python3
"""
Prints the chat ids of everyone who has messaged your bot.

Send your bot any message first, then run this. Have your girlfriend
do the same and run it again. Put both ids in pool_members.

  TELEGRAM_BOT_TOKEN=... python scripts/get_chat_id.py

Note: getUpdates stops returning data once a webhook is registered.
Run this before deploying, or call deleteWebhook first.
"""

import json
import os
import urllib.request

token = os.environ.get("TELEGRAM_BOT_TOKEN")
if not token:
    raise SystemExit("set TELEGRAM_BOT_TOKEN first")

url = f"https://api.telegram.org/bot{token}/getUpdates"
with urllib.request.urlopen(url, timeout=15) as r:
    data = json.loads(r.read().decode())

if not data.get("ok"):
    raise SystemExit(f"telegram said: {data}")

seen = {}
for u in data.get("result", []):
    msg = u.get("message") or u.get("edited_message") or {}
    chat = msg.get("chat")
    if chat:
        seen[chat["id"]] = chat.get("first_name") or chat.get("title") or "?"

if not seen:
    print("No messages found. Send your bot a message, then run this again.")
else:
    print("chat ids:")
    for cid, name in seen.items():
        print(f"  {cid}  {name}")
