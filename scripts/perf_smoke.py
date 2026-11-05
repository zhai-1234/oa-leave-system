# -*- coding: utf-8 -*-
"""性能冒烟测试：给出答辩可引用的关键路径耗时。"""
import json
import os
import sys
import tempfile
import time
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

TMP = tempfile.TemporaryDirectory()
os.environ["LEAVE_DB_PATH"] = str(Path(TMP.name) / "perf.db")

import ai_assistant as ai
import server

# 规则版，避免外网和 API 费用干扰测量
ai._llm_extract = lambda text: None
ai._llm_enabled = lambda: False
server.init_db()


def measure(name, fn, n=30):
    t0 = time.perf_counter()
    for _ in range(n):
        fn()
    elapsed = time.perf_counter() - t0
    return {"name": name, "n": n, "total_s": round(elapsed, 4), "avg_ms": round(elapsed * 1000 / n, 2)}


results = []
def count_users():
    conn = server.db()
    try:
        return conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    finally:
        conn.close()


def query_balances():
    conn = server.db()
    try:
        return conn.execute("SELECT * FROM leave_balances WHERE user_id=?", (1,)).fetchall()
    finally:
        conn.close()


results.append(measure("db_count_users", count_users, 50))
results.append(measure("db_query_balances", query_balances, 50))
results.append(measure("parse_leave_simple", lambda: ai.parse_leave("明天请事假去银行办事", user={"id": 1, "role": "employee"}), 30))
results.append(measure("parse_leave_vague", lambda: ai.parse_leave("帮我请一个下周一到周五的假", user={"id": 1, "role": "employee"}), 30))

out = ROOT / "outputs" / "perf_report.json"
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps({"backend": os.environ.get("LEAVE_DB_BACKEND", "sqlite"), "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"backend": os.environ.get("LEAVE_DB_BACKEND", "sqlite"), "results": results}, ensure_ascii=False, indent=2))
print(f"\n报告已写入: {out}")
