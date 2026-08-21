"""
Manual / HTTP trigger for the scheduled jobs.
  /api/cron?job=morning&key=CRON_SECRET
  /api/cron?job=evening&key=CRON_SECRET
  /api/cron?job=close&key=CRON_SECRET
"""

import json
import os
import sys
import urllib.parse

sys.path.append(os.path.dirname(__file__))

from http.server import BaseHTTPRequestHandler  # noqa: E402

from _lib import jobs, pool as P  # noqa: E402

JOBS = {"morning": jobs.morning, "evening": jobs.evening, "close": jobs.close_cycles}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        job = (q.get("job") or [""])[0]
        key = (q.get("key") or [""])[0]

        if P.CRON_SECRET and key != P.CRON_SECRET:
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b"bad key")
            return

        if job not in JOBS:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"job must be morning, evening or close")
            return

        try:
            result = JOBS[job]()
            body = json.dumps({"job": job, "result": str(result)}).encode()
            code = 200
        except Exception as e:
            body = json.dumps({"job": job, "error": repr(e)}).encode()
            code = 500

        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)
