# -*- coding: utf-8 -*-
"""一键生成/重置演示数据：保留账号与余额，重建一批多状态请假记录与审批日志。"""
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import server as legacy


def seed():
    legacy.init_db()
    conn = legacy.db()
    for t in ("leave_adjustments", "adjustment_logs", "notifications", "approval_logs", "attachments", "leave_requests", "leave_balances"):
        try:
            conn.execute("DELETE FROM " + t)
        except Exception:
            pass
    approver = conn.execute("SELECT id FROM users WHERE role='approver' LIMIT 1").fetchone()
    if not approver:
        conn.close()
        print("未找到审批员账号，请先运行一次服务以初始化数据")
        return
    approver_id = approver["id"]
    emps = [dict(r) for r in conn.execute("SELECT id, name FROM users WHERE role='employee' ORDER BY id")]
    if not emps:
        conn.close()
        print("未找到员工账号")
        return

    for emp in emps:
        u = conn.execute("SELECT continuous_years, unit_years, gender FROM users WHERE id=?", (emp["id"],)).fetchone()
        cy = float(u["continuous_years"] or 0)
        uy = float(u["unit_years"] or 0)
        defaults = {"年休假": legacy.annual_leave_days(cy), "事假": 20, "丧假": 3, "路程假": 3, "育儿假": 10, "婚假": 3,
                    "产假": 98, "奖励假": 80, "妇女节假期": 0.5, "陪产假": 15, "一次性短期病假": 2, "护理假": 15,
                    "法定病假": legacy.medical_period_months(cy, uy) * 30}
        for typ, amt in defaults.items():
            conn.execute("INSERT OR IGNORE INTO leave_balances(user_id,leave_type,remaining_days) VALUES(?,?,?)", (emp["id"], typ, amt))
    conn.execute("DELETE FROM leave_balances WHERE leave_type='陪产假' AND user_id IN (SELECT id FROM users WHERE gender<>'男')")
    conn.execute("DELETE FROM leave_balances WHERE leave_type IN ('产假','奖励假','妇女节假期') AND user_id IN (SELECT id FROM users WHERE gender<>'女')")

    now = datetime.now()
    seq = [0]

    def add(emp_idx, typ, start_off, dur, reason, material, emergency, status, comment, round_):
        seq[0] += 1
        policy = legacy.LEAVE_POLICIES.get(typ, {})
        start = (now + timedelta(days=start_off)).replace(hour=9, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=dur - 1)
        end = end.replace(hour=18, minute=0, second=0, microsecond=0)
        days = legacy.leave_days(conn, start.isoformat(sep=" ", timespec="seconds"), end.isoformat(sep=" ", timespec="seconds"), policy.get("unit", "工作日"))
        emp = emps[emp_idx % len(emps)]
        req_no = "QJ" + now.strftime("%Y%m%d") + str(seq[0]).zfill(3)
        submitted = now - timedelta(days=1)
        conn.execute(
            """INSERT INTO leave_requests(user_id,request_no,leave_type,start_time,end_time,days,reason,material_status,
               emergency_report,status,review_round,submitted_at,updated_at,deadline_at,approver_comment)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (emp["id"], req_no, typ, start.isoformat(sep=" ", timespec="seconds"), end.isoformat(sep=" ", timespec="seconds"),
             days, reason, material, emergency, status, round_, submitted.isoformat(sep=" ", timespec="seconds"),
             now.isoformat(sep=" ", timespec="seconds"), (now + timedelta(days=1)).isoformat(sep=" ", timespec="seconds"), comment))
        rid = conn.execute("SELECT id FROM leave_requests WHERE request_no=?", (req_no,)).fetchone()["id"]
        if status != "pending":
            action = {"approved": "approve", "rejected": "reject", "returned": "return", "supplement_required": "supplement", "reported": "approve"}.get(status, "approve")
            conn.execute("INSERT INTO approval_logs(request_id,approver_id,action,comment,created_at,round) VALUES(?,?,?,?,?,?)",
                         (rid, approver_id, action, comment, now.isoformat(sep=" ", timespec="seconds"), round_))
        return emp["name"], typ, status

    rows = [
        (0, "年休假", 7, 3, "家庭出行", "complete", 0, "pending", "", 1),
        (1, "病假", 1, 1, "身体不适", "pending", 0, "pending", "", 1),
        (2, "婚假", 3, 3, "结婚", "complete", 0, "pending", "", 1),
        (0, "事假", -14, 1, "办理个人事务", "complete", 0, "approved", "同意", 1),
        (1, "年休假", -30, 5, "探亲", "complete", 0, "approved", "同意", 1),
        (2, "育儿假", -10, 3, "照顾孩子", "complete", 0, "approved", "同意，注意材料", 1),
        (1, "事假", -5, 3, "办理个人事务", "complete", 0, "rejected", "事由不充分，请补充说明", 1),
        (2, "年休假", -3, 2, "探亲", "complete", 0, "rejected", "项目关键期无法批假", 1),
        (0, "事假", -2, 1, "办理个人事务", "complete", 0, "returned", "请补充具体事由", 1),
        (2, "病假", -1, 1, "", "pending", 0, "returned", "请补充病假证明", 1),
        (1, "丧假", -1, 3, "亲属去世", "pending", 0, "supplement_required", "请补交亲属关系证明", 1),
        (0, "婚假", 5, 3, "结婚", "pending", 0, "supplement_required", "请补交结婚证", 1),
        (2, "事假", 0, 1, "突发情况", "pending", 1, "reported", "休假结束后请及时补办", 1),
    ]
    for r in rows:
        add(*r)
    conn.commit()
    total = conn.execute("SELECT COUNT(*) FROM leave_requests").fetchone()[0]
    conn.close()
    print("演示数据已重置：共 %d 条请假记录" % total)


if __name__ == "__main__":
    seed()
