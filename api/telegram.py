"""
Telegram webhook. Deployed at /api/telegram on Vercel.

Always returns 200. Telegram retries anything else, and a retry storm
on a parsing bug would spam you with duplicate messages.
"""

import json
import os
import sys

sys.path.append(os.path.dirname(__file__))

from http.server import BaseHTTPRequestHandler  # noqa: E402

from _lib import pool as P  # noqa: E402


def handle_update(update):
    if "callback_query" in update:
        return handle_callback(update["callback_query"])
    message = update.get("message") or update.get("edited_message")
    if not message:
        return
    chat_id = message["chat"]["id"]
    text = message.get("text", "")

    try:
        member = P.get_member(chat_id)
    except P.PoolError:
        P.send(
            chat_id,
            "You are not registered to a pool.\n\n"
            f"Your chat id is <code>{chat_id}</code>. "
            "Add it to <code>pool_members</code> to get access.",
        )
        return

    pool_id = member["pool_id"]
    command, args = P.parse_message(text)

    if command == "log":
        amount, category, note = args["amount"], args["category"], args["note"]
        if not category:
            P.send(
                chat_id,
                f"<b>{P.vnd(amount)}</b> — what for?",
                keyboard=P.category_keyboard(amount, note),
            )
            return
        st = P.add_entry(pool_id, chat_id, amount, category, note)
        P.send(chat_id, P.msg_logged(amount, category, st))
        P.notify_partner(pool_id, chat_id, member["display_name"], amount, category, st)

    elif command == "today":
        st = P.state(pool_id)
        P.send(chat_id, P.msg_today(pool_id, st, P.entries_on(pool_id, st["ref_date"])))

    elif command == "status":
        P.send(chat_id, P.msg_status(P.state(pool_id)))

    elif command == "month":
        st = P.state(pool_id)
        P.send(chat_id, P.msg_month(st, P.breakdown(pool_id)))

    elif command == "undo":
        removed = P.undo_last(pool_id, chat_id)
        if not removed:
            P.send(chat_id, "Nothing of yours to undo.")
            return
        st = P.state(pool_id)
        P.send(
            chat_id,
            f"↩️ Removed <b>{P.vnd(removed['amount'])}</b> · {removed['category']}\n"
            + P.line_number(st),
        )

    else:
        P.send(chat_id, P.msg_help())


def handle_callback(cq):
    chat_id = cq["message"]["chat"]["id"]
    message_id = cq["message"]["message_id"]
    data = cq.get("data", "")

    P.answer_callback(cq["id"])

    if not data.startswith("c|"):
        return

    bits = data.split("|")
    amount = int(bits[1])
    category = bits[2]
    note = bits[3] if len(bits) > 3 else None

    try:
        member = P.get_member(chat_id)
    except P.PoolError:
        return

    st = P.add_entry(member["pool_id"], chat_id, amount, category, note)
    P.edit_text(chat_id, message_id, P.msg_logged(amount, category, st))
    P.notify_partner(
        member["pool_id"], chat_id, member["display_name"], amount, category, st
    )


class handler(BaseHTTPRequestHandler):
    def _ok(self, body=b"ok"):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._ok(b"pool bot up")

    def do_POST(self):
        # Telegram sets this header when the webhook is registered with a secret.
        if P.WEBHOOK_SECRET:
            got = self.headers.get("X-Telegram-Bot-Api-Secret-Token")
            if got != P.WEBHOOK_SECRET:
                self.send_response(401)
                self.end_headers()
                return

        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"

        try:
            update = json.loads(raw)
        except json.JSONDecodeError:
            self._ok()
            return

        try:
            handle_update(update)
        except Exception as e:  # never 500, or Telegram retries forever
            print("handler error:", repr(e))
            try:
                chat = (
                    update.get("message", {}).get("chat", {}).get("id")
                    or update.get("callback_query", {})
                    .get("message", {})
                    .get("chat", {})
                    .get("id")
                )
                if chat:
                    P.send(chat, "Something broke on my side. Try again in a moment.")
            except Exception:
                pass

        self._ok()
