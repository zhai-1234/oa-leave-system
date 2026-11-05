# -*- coding: utf-8 -*-
"""AI 请假解析评估脚本：答辩用准确率数据。

默认跑规则版（不消耗 LLM），输出 JSON + Markdown 表格。
需要真实模型时加 --llm。
"""
import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import ai_assistant as ai

TODAY = date.today()
TOMORROW = (TODAY + timedelta(days=1)).isoformat()
NEXT_MONDAY = TODAY + timedelta(days=(7 - TODAY.weekday()))
NEXT_TUESDAY = NEXT_MONDAY + timedelta(days=1)
NEXT_WEDNESDAY = NEXT_MONDAY + timedelta(days=2)
NEXT_FRIDAY = NEXT_MONDAY + timedelta(days=4)

CASES = [
    {"text": "明天请事假去银行办事", "type": "事假", "reason": "去银行办事", "start": TOMORROW, "complete": True},
    {"text": "明天请事假，不想上班", "type": "事假", "reason": "不想上班", "reason_valid": "不合理", "start": TOMORROW},
    {"text": "帮我请一个下周一到周五的假", "type": None, "reason": "", "has_start": True, "complete": False},
    {"text": "帮我请个假", "type": None, "reason": "", "has_start": False, "complete": False},
    {"text": "明天身体不舒服", "type": "一次性短期病假", "reason": "身体不舒服", "start": TOMORROW, "complete": True},
    {"text": "下周三到周五休年假", "type": "年休假", "days": 3, "has_start": True, "complete": True},
    {"text": "下周一到周二请事假，家里有事", "type": "事假", "reason": "家里有事", "has_start": True, "complete": True},
    {"text": "明天请婚假，回老家办婚礼", "type": "婚假", "reason": "回老家办婚礼", "start": TOMORROW},
    {"text": "后天请丧假，需要回老家", "type": "丧假", "reason": "需要回老家", "start": (TODAY + timedelta(days=2)).isoformat()},
    {"text": "明天请短期病假，感冒发烧", "type": "一次性短期病假", "reason": "感冒发烧", "start": TOMORROW},
]


def one_case(case):
    r = ai.parse_leave(case["text"], user={"id": 1, "role": "employee"})
    checks = {}
    if "type" in case:
        checks["type"] = (r.get("leave_type") == case["type"])
    if "reason" in case:
        checks["reason"] = ((r.get("reason") or "") == (case["reason"] or ""))
    if "reason_valid" in case:
        checks["reason_valid"] = (r.get("reason_valid") == case["reason_valid"])
    if "start" in case:
        checks["start"] = (r.get("start_date") == case["start"])
    if "has_start" in case:
        checks["has_start"] = (bool(r.get("start_date")) == case["has_start"])
    if "days" in case:
        checks["days"] = (r.get("days") == case["days"])
    if "complete" in case:
        checks["complete"] = (r.get("complete") == case["complete"])
    return r, checks, len(checks) and all(checks.values())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--llm", action="store_true", help="使用已配置 LLM，而不是规则版")
    args = ap.parse_args()

    if not args.llm:
        ai._llm_extract = lambda text: None
        ai._llm_enabled = lambda: False

    rows = []
    metrics = {}
    for case in CASES:
        r, checks, ok = one_case(case)
        row = {
            "text": case["text"],
            "pred_type": r.get("leave_type"),
            "pred_reason": r.get("reason") or "",
            "pred_start": r.get("start_date"),
            "pred_days": r.get("days"),
            "reason_valid": r.get("reason_valid"),
            "complete": r.get("complete"),
            "checks": checks,
            "ok": ok,
        }
        rows.append(row)
        for k, v in checks.items():
            metrics.setdefault(k, {"pass": 0, "total": 0})
            metrics[k]["total"] += 1
            metrics[k]["pass"] += int(v)
        metrics.setdefault("overall", {"pass": 0, "total": 0})
        metrics["overall"]["total"] += 1
        metrics["overall"]["pass"] += int(ok)

    summary = {k: {"pass": v["pass"], "total": v["total"], "acc": round(v["pass"] / v["total"], 4)} for k, v in metrics.items()}
    report = {"mode": "llm" if args.llm else "rule", "date": TODAY.isoformat(), "summary": summary, "cases": rows}
    out = ROOT / "outputs" / "ai_eval_report.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("AI 解析评估报告")
    print("=" * 60)
    for k, v in summary.items():
        print(f"{k:12s} {v['pass']}/{v['total']}  {v['acc']:.1%}")
    print("=" * 60)
    for row in rows:
        mark = "PASS" if row["ok"] else "FAIL"
        print(f"[{mark}] {row['text']}")
        print(f"       type={row['pred_type']} reason={row['pred_reason']} start={row['pred_start']} days={row['pred_days']}")
    print(f"\n报告已写入: {out}")


if __name__ == "__main__":
    main()
