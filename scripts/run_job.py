#!/usr/bin/env python3
"""
Runs a scheduled job directly. This is what GitHub Actions calls,
so the cron path never depends on Vercel being warm.

  python scripts/run_job.py morning
  python scripts/run_job.py evening
  python scripts/run_job.py close
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from _lib import jobs  # noqa: E402

JOBS = {"morning": jobs.morning, "evening": jobs.evening, "close": jobs.close_cycles}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in JOBS:
        print("usage: run_job.py [morning|evening|close]")
        sys.exit(1)
    job = sys.argv[1]
    result = JOBS[job]()
    print(f"{job}: {result}")


if __name__ == "__main__":
    main()
