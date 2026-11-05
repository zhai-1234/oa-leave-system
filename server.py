#!/usr/bin/env python3
"""局域网请假系统原型：仅使用 Python 标准库。"""

import hashlib
import base64
import json
import mimetypes
import os
import secrets
import db as database
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from datetime import date, datetime, timedelta
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("LEAVE_DB_PATH", ROOT / "leave_system.db"))
STATIC = ROOT / "static"
UPLOADS = ROOT / "uploads"
SESSIONS = {}
PASSWORD_HASHER = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)

# 制度配置。年度法定节假日、调休工作日通过数据库单独维护。
LEAVE_POLICIES = {
    "年休假": {"unit":"工作日","limit":"按累计工龄 5/10/15 天","advance":5,"timing":"原则上提前 5 个工作日申请，经审批同意后休假","material":"无需证明材料，无需填写请假事由","proof":False,"reason_required":False},
    "事假": {"unit":"工作日","limit":"单次原则不超过 3 天，年度累计原则不超过 20 天","max_per_request":3,"annual_limit":20,"advance":1,"timing":"原则上提前 1 个工作日；突发情况及时报备并事后补办","material":"如实说明事由；公司有合理理由时提供必要说明材料","proof":False},
    "丧假": {"unit":"自然日","limit":"3 个自然日","max_per_request":3,"annual_limit":3,"advance":0,"timing":"可及时报备并申请；紧急未申请的，休假结束后补办","material":"死亡证明、户籍注销证明或亲属关系等证明；紧急时可后补","proof":True},
    "路程假": {"unit":"自然日","limit":"单次原则不超过 3 天，须与婚假或丧假连续","max_per_request":3,"advance":0,"timing":"与婚假或丧假一并申请，并说明往返行程和时间","material":"关联婚假/丧假申请，说明出行事由及行程；必要时提供辅助材料","proof":True},
    "育儿假": {"unit":"工作日","limit":"子女未满 3 周岁，每周年 10 天，原则不超过 2 次","annual_limit":10,"max_uses":2,"advance":3,"timing":"原则上提前 3 个工作日；紧急照护可先报备后补办","material":"子女出生医学证明或户口簿；已备案可不重复提交","proof":True},
    "婚假": {"unit":"自然日","limit":"3 个连续自然日","max_per_request":3,"annual_limit":3,"advance":3,"timing":"原则上提前 3 个工作日；客观原因可先报备、休假后补办","material":"结婚证复印件或其他有效证明；客观原因可后补","proof":True},
    "产假": {"unit":"自然日","limit":"98 个连续自然日","max_per_request":98,"annual_limit":98,"advance":None,"timing":"起始时间由女职工结合身体状况及医疗建议决定","material":"孕检证明、出生医学证明或其他生育证明；可在产后合理期限补交","proof":True},
    "奖励假": {"unit":"自然日","limit":"80 个连续自然日，与产假原则上连续安排","max_per_request":80,"annual_limit":80,"advance":None,"timing":"在法定产假基础上，按规定与产假连续安排","material":"孕检证明、出生医学证明或其他生育证明；可在产后合理期限补交","proof":True},
    "妇女节假期": {"unit":"工作日","limit":"3 月 8 日半天，由公司统一安排","application_required":False,"advance":None,"timing":"公司原则上提前 2 个工作日通知，员工无需申请","material":"无需证明材料","proof":False},
    "陪产假": {"unit":"自然日","limit":"15 个连续自然日","max_per_request":15,"annual_limit":15,"advance":3,"timing":"原则上提前 3 个工作日；分娩时间不确定可先报备后补办","material":"配偶生育证明，包括出生医学证明、结婚证等；可后补","proof":True},
    "一次性短期病假": {"unit":"工作日","limit":"每自然年度一次、2 个工作日","max_per_request":2,"annual_limit":2,"max_uses":1,"advance":0,"timing":"当日或最迟次工作日完成报备或申请","material":"无需证明材料，无需填写请假事由","proof":False,"reason_required":False},
    "护理假": {"unit":"工作日","limit":"父母满 60 岁每年 5 天；住院治疗累计不超过 15 天，原则不超过 2 次","annual_limit":15,"max_uses":2,"advance":5,"timing":"父母满 60 岁提前 5 个工作日；住院治疗可随时申请或先报备","material":"独生子女/计生证明、父母年龄及户籍证明；住院情形另附医疗材料，可返岗后补交","proof":True},
    "法定病假": {"unit":"自然日","limit":"计入依法核定的医疗期","advance":0,"timing":"当日或最迟次工作日申请；住院、急诊可由家属报备，返岗后补办","material":"合法医疗机构病假证明、诊断证明或住院证明；急诊、住院可后补","proof":True},
}


def annual_leave_days(continuous_years):
    years = float(continuous_years or 0)
    if years < 1: return 0
    if years < 10: return 5
    if years < 20: return 10
    return 15


def current_year_annual_leave(continuous_years, hire_date=""):
    entitlement = annual_leave_days(continuous_years)
    if not hire_date or entitlement == 0: return entitlement
    hired = date.fromisoformat(hire_date)
    if hired.year != date.today().year: return entitlement
    months = max(0, 12 - hired.month + 1)
    return int(entitlement * months / 12)


def medical_period_months(continuous_years, unit_years):
    cy, uy = float(continuous_years or 0), float(unit_years or 0)
    if cy <= 10: return 3 if uy <= 5 else 6 if uy < 10 else 9
    if cy < 15: return 6 if uy <= 5 else 9 if uy < 10 else 12
    if cy < 20: return 9 if uy <= 5 else 12 if uy < 10 else 18
    return 12 if uy <= 5 else 18 if uy < 10 else 24


def leave_days(conn, start_text, end_text, unit):
    start = datetime.fromisoformat(start_text.replace("T", " ")).date()
    end = datetime.fromisoformat(end_text.replace("T", " ")).date()
    if end < start: raise ValueError("结束时间不能早于开始时间")
    if unit == "自然日": return float((end - start).days + 1)
    special = {r["holiday_date"]: r["day_type"] for r in conn.execute(
        "SELECT holiday_date,day_type FROM calendar_days WHERE holiday_date BETWEEN ? AND ?", (start.isoformat(), end.isoformat()))}
    count = 0
    day = start
    while day <= end:
        kind = special.get(day.isoformat())
        if kind == "workday" or (kind is None and day.weekday() < 5): count += 1
        day += timedelta(days=1)
    # 同一工作日内的半天申请由前端显式选择 0.5。
    return float(count)


def advance_workdays(conn, submitted, start_text):
    """从提交日（含）至休假开始日前一日的工作日数量。"""
    begin = submitted.date() if isinstance(submitted, datetime) else submitted
    start = datetime.fromisoformat(start_text.replace("T", " ")).date()
    if start <= begin: return 0
    special = {r["holiday_date"]:r["day_type"] for r in conn.execute(
        "SELECT holiday_date,day_type FROM calendar_days WHERE holiday_date>=? AND holiday_date<?",(begin.isoformat(),start.isoformat()))}
    count=0; day=begin
    while day < start:
        kind=special.get(day.isoformat())
        if kind=="workday" or (kind is None and day.weekday()<5): count+=1
        day+=timedelta(days=1)
    return count


def db():
    return database.connect()


def legacy_password_hash(value):
    return hashlib.sha256(("leave-system-v1:" + value).encode()).hexdigest()


def password_hash(value):
    return PASSWORD_HASHER.hash(value)


def verify_password(stored, value):
    if str(stored).startswith("$argon2"):
        try:return PASSWORD_HASHER.verify(stored,value)
        except (VerifyMismatchError,InvalidHashError):return False
    return secrets.compare_digest(str(stored),legacy_password_hash(value))


def now_iso():
    return datetime.now().replace(microsecond=0).isoformat(sep=" ")


def init_db():
    UPLOADS.mkdir(exist_ok=True)
    conn = db()
    database.init_schema(conn)
    conn.execute("UPDATE users SET department='综合管理部' WHERE department IS NULL OR trim(department)=''")
    if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
        users = [
            ("employee", "123456", "张晓雨", "女", 29, 4.5, 7.0, "employee"),
            ("approver", "123456", "王主管", "男", 38, 10.0, 14.0, "approver"),
            ("liuming", "123456", "刘明", "男", 32, 3.0, 8.0, "employee"),
            ("chenxi", "123456", "陈曦", "女", 26, 1.5, 3.0, "employee"),
            ("manager", "123456", "李经理", "女", 45, 12.0, 18.0, "approver"),
            ("zhuguan", "123456", "王主管", "男", 38, 10.0, 14.0, "employee"),
            ("jingli", "123456", "李经理", "女", 45, 12.0, 18.0, "employee"),
            ("director", "123456", "赵总监", "男", 50, 15.0, 22.0, "approver"),
            ("zongjian", "123456", "赵总监", "男", 50, 15.0, 22.0, "employee"),
        ]
        conn.executemany("INSERT INTO users(username,password_hash,name,gender,age,unit_years,continuous_years,role) VALUES(?,?,?,?,?,?,?,?)",
                         [(u, password_hash(p), n, g, a, uy, cy, r) for u,p,n,g,a,uy,cy,r in users])
        for uid in (1, 3, 4, 5, 6, 7, 9):
            user_years = {1: 7, 3: 8, 4: 3, 5: 18, 6: 14, 7: 18, 9: 22}[uid]
            for leave_type, days in [("年休假", annual_leave_days(user_years)), ("事假", 20), ("丧假", 3), ("路程假", 3),
                ("育儿假", 10), ("婚假", 3), ("产假", 98), ("奖励假", 80), ("妇女节假期", .5),
                ("陪产假", 15), ("一次性短期病假", 2), ("护理假", 15), ("法定病假", medical_period_months(user_years, 3)*30)]:
                conn.execute("INSERT INTO leave_balances(user_id,leave_type,remaining_days) VALUES(?,?,?)", (uid, leave_type, days))
        samples = [
          (1,"年休假","2026-08-20 09:00","2026-08-21 18:00",2,"家庭出行","complete",0,"pending",1,0,""),
          (3,"病假","2026-08-18 09:00","2026-08-19 18:00",2,"身体不适","pending",0,"pending",1,2,""),
          (4,"事假","2026-08-22 09:00","2026-08-22 18:00",1,"办理个人事务","complete",0,"returned",2,1,"请补充具体事由"),
          (3,"调休","2026-08-25 13:00","2026-08-25 18:00",0.5,"加班调休","complete",0,"approved",1,3,""),
          (4,"病假","2026-08-16 09:00","2026-08-16 18:00",1,"突发高烧","pending",1,"reported",1,1,"休假结束后请及时补办"),
          (1,"婚假","2026-09-01 09:00","2026-09-05 18:00",5,"办理婚礼","supplement_requested",0,"supplement_required",2,2,"请补充结婚证明"),
          (3,"年休假","2026-08-28 09:00","2026-08-29 18:00",2,"返乡探亲","complete",0,"rejected",1,4,"与项目节点冲突"),
        ]
        base = datetime.now() - timedelta(hours=3)
        for i, row in enumerate(samples, 1):
            uid, typ, start, end, days, reason, material, emergency, status, rnd, age_hours, comment = row
            submitted = base - timedelta(hours=age_hours)
            if i == 2: submitted = datetime.now() - timedelta(hours=30)
            req_no = f"QJ{date.today():%Y%m%d}{i:03d}"
            conn.execute("""INSERT INTO leave_requests(user_id,request_no,leave_type,start_time,end_time,days,reason,material_status,
                emergency_report,status,review_round,submitted_at,updated_at,deadline_at,approver_comment)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (uid,req_no,typ,start,end,days,reason,material,emergency,status,rnd,submitted.isoformat(sep=' ',timespec='seconds'),now_iso(),
                 (submitted+timedelta(days=1)).isoformat(sep=' ',timespec='seconds'),comment))
    # 兼容已有数据库：确保经理审批员账号存在。
    if not conn.execute("SELECT id FROM users WHERE username='manager'").fetchone():
        conn.execute("INSERT INTO users(username,password_hash,name,gender,age,unit_years,continuous_years,role) VALUES(?,?,?,?,?,?,?,?)",
            ("manager", password_hash("123456"), "李经理", "女", 45, 12.0, 18.0, "approver"))

    # 兼容已有数据库：为审批员和经理补充各自的员工账号。
    for username, name, gender, age, uy, cy, role in (
        ("zhuguan", "王主管", "男", 38, 10.0, 14.0, "employee"),
        ("jingli", "李经理", "女", 45, 12.0, 18.0, "employee"),
        ("director", "赵总监", "男", 50, 15.0, 22.0, "approver"),
        ("zongjian", "赵总监", "男", 50, 15.0, 22.0, "employee"),
    ):
        if not conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone():
            conn.execute("INSERT INTO users(username,password_hash,name,gender,age,unit_years,continuous_years,role) VALUES(?,?,?,?,?,?,?,?)",
                (username, password_hash("123456"), name, gender, age, uy, cy, role))

    # 建立审批账号与员工账号的关联，以及员工的上级审批账号。
    mapping = (
        ("approver", "zhuguan"),
        ("manager", "jingli"),
        ("director", "zongjian"),
    )
    for approver_username, employee_username in mapping:
        conn.execute("UPDATE users SET linked_employee_id=(SELECT id FROM users WHERE username=?) WHERE username=?", (employee_username, approver_username))
        conn.execute("UPDATE users SET approval_approver_id=0 WHERE username=?", (employee_username,))
    conn.execute("UPDATE users SET approval_approver_id=(SELECT id FROM users WHERE username='approver') WHERE username IN ('employee','liuming','chenxi')")
    conn.execute("UPDATE users SET approval_approver_id=(SELECT id FROM users WHERE username='manager') WHERE username='zhuguan'")
    conn.execute("UPDATE users SET approval_approver_id=(SELECT id FROM users WHERE username='director') WHERE username='jingli'")
    conn.execute("UPDATE users SET approval_approver_id=0 WHERE username='zongjian'")

    # 将已有账号同步到最新假期类型；年休假按连续工龄更新法定额度。
    for user in conn.execute("SELECT * FROM users WHERE role IN ('employee','approver')"):
        defaults = {"年休假": annual_leave_days(user["continuous_years"]), "事假": 20, "丧假": 3, "路程假": 3,
            "育儿假": 10, "婚假": 3, "产假": 98, "奖励假": 80, "妇女节假期": .5, "陪产假": 15,
            "一次性短期病假": 2, "护理假": 15, "法定病假": medical_period_months(user["continuous_years"],user["unit_years"])*30}
        for typ, amount in defaults.items():
            conn.execute("INSERT OR IGNORE INTO leave_balances(user_id,leave_type,remaining_days) VALUES(?,?,?)", (user["id"],typ,amount))
    # 按员工性别清理不适用的生育类假期余额。
    conn.execute("""DELETE FROM leave_balances WHERE leave_type='陪产假' AND user_id IN
        (SELECT id FROM users WHERE gender<>'男')""")
    conn.execute("""DELETE FROM leave_balances WHERE leave_type IN ('产假','奖励假','产假/陪产假') AND user_id IN
        (SELECT id FROM users WHERE gender<>'女')""")
    conn.execute("DELETE FROM leave_balances WHERE leave_type='产假/陪产假'")
    conn.commit(); conn.close()


def rows(items): return [dict(x) for x in items]


def bind_attachments(conn, tokens, user_id, entity_type, entity_id):
    for token in tokens or []:
        conn.execute("""UPDATE attachments SET entity_type=?,entity_id=?
            WHERE token=? AND user_id=? AND entity_type='pending'""",(entity_type,entity_id,str(token),user_id))


def attachment_rows(conn, entity_type, entity_id):
    return rows(conn.execute("""SELECT id,original_name,mime_type,size,'/uploads/'||stored_name url,created_at
        FROM attachments WHERE entity_type=? AND entity_id=? ORDER BY created_at""",(entity_type,entity_id)))


def notify_user(conn, user_id, title, message, request_id=0, category="leave"):
    conn.execute("""INSERT INTO notifications(user_id,title,message,category,request_id,created_at)
        VALUES(?,?,?,?,?,?)""",(user_id,title,message,category,request_id,now_iso()))


def active_approval_delegation(conn, approver_id, today=None):
    today = today or date.today().isoformat()
    return conn.execute(
        "SELECT * FROM approval_delegations WHERE approver_id=? AND status='active' AND start_date<=? AND end_date>=? ORDER BY created_at DESC, id DESC LIMIT 1",
        (approver_id, today, today),
    ).fetchone()


def approval_scope_user_ids(conn, approver_id):
    """返回当前审批员可查看/可审批的申请人 user_id 集合。"""
    today = date.today().isoformat()
    scope = {r["id"] for r in conn.execute(
        "SELECT id FROM users WHERE approval_approver_id=?", (approver_id,)
    ).fetchall()}
    delegated_approvers = [r["approver_id"] for r in conn.execute(
        "SELECT approver_id FROM approval_delegations WHERE delegate_approver_id=? AND status='active' AND start_date<=? AND end_date>=?",
        (approver_id, today, today),
    ).fetchall()]
    if delegated_approvers:
        marks = ",".join("?" * len(delegated_approvers))
        scope.update(r["id"] for r in conn.execute(
            "SELECT id FROM users WHERE approval_approver_id IN (%s)" % marks,
            tuple(delegated_approvers),
        ).fetchall())
    return scope


def notify_approvers(conn, title, message, request_id=0, category="leave", applicant_id=None):
    approvers = conn.execute("SELECT id FROM users WHERE role='approver'").fetchall()
    targets = set()
    superior_id = 0
    if applicant_id is not None:
        applicant = conn.execute("SELECT approval_approver_id FROM users WHERE id=?", (applicant_id,)).fetchone()
        if applicant:
            superior_id = int(applicant["approval_approver_id"] or 0)
    if superior_id:
        delegation = active_approval_delegation(conn, superior_id)
        targets.add(delegation["delegate_approver_id"] if delegation and delegation["delegate_approver_id"] else superior_id)
    else:
        for row in approvers:
            if applicant_id is not None and row["id"] == applicant_id:
                continue
            delegation = active_approval_delegation(conn, row["id"])
            if delegation and delegation["delegate_approver_id"]:
                targets.add(delegation["delegate_approver_id"])
            else:
                targets.add(row["id"])
    if not targets:
        for row in approvers:
            if applicant_id is None or row["id"] != applicant_id:
                targets.add(row["id"])
    for uid in targets:
        notify_user(conn, uid, title, message, request_id, category)


def add_approval_balance(conn, item):
    """仅为审批决策提供当前假种的最小必要余额，不暴露其他假种明细。"""
    balance_type={"病假":"法定病假"}.get(item["leave_type"],item["leave_type"])
    balance=conn.execute("""SELECT remaining_days FROM leave_balances
        WHERE user_id=? AND leave_type=?""",(item["user_id"],balance_type)).fetchone()
    account_balance=float(balance["remaining_days"]) if balance else 0.0
    pending=conn.execute("""SELECT COALESCE(SUM(days),0) occupied FROM leave_requests
        WHERE user_id=? AND leave_type=? AND id<>?
          AND status IN ('pending','reported','supplement_required')""",
        (item["user_id"],item["leave_type"],item["id"])).fetchone()
    pending_occupied=float(pending["occupied"] or 0)
    available=max(0.0,account_balance-pending_occupied)
    item["account_balance"]=account_balance
    item["pending_occupied"]=pending_occupied
    item["available_balance"]=available
    item["balance_after_approval"]=max(0.0,available-float(item["days"] or 0))
    item["balance_sufficient"]=float(item["days"] or 0)<=available


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): print(f"[{self.log_date_time_string()}] {fmt % args}")

    def send_json(self, data, status=200, headers=None):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(body)

    def body(self):
        try: return json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        except Exception: return {}

    def user(self):
        jar = cookies.SimpleCookie(self.headers.get("Cookie")); token = jar.get("session")
        if not token:return None
        conn=db();session=conn.execute("""SELECT user_id FROM sessions
            WHERE token=? AND datetime(expires_at)>datetime('now','localtime')""",(token.value,)).fetchone()
        if not session:conn.close();return None
        user=conn.execute("SELECT * FROM users WHERE id=?",(session["user_id"],)).fetchone(); conn.close()
        return dict(user) if user else None

    def require(self, role=None):
        user=self.user()
        if not user: self.send_json({"error":"请先登录"},401); return None
        if role and user["role"] != role: self.send_json({"error":"无权访问审批功能"},403); return None
        return user

    def do_GET(self):
        path=urlparse(self.path).path
        if path == "/api/me":
            user=self.require();
            if not user:return
            conn=db(); balances=rows(conn.execute("SELECT leave_type,remaining_days FROM leave_balances WHERE user_id=?",(user['id'],)))
            year=str(date.today().year)
            totals={r["leave_type"]:r["total"] for r in conn.execute("""SELECT leave_type,COALESCE(SUM(days),0) total FROM leave_requests
                WHERE user_id=? AND substr(start_time,1,4)=? AND status='approved' GROUP BY leave_type""",(user['id'],year))}
            if user["role"]=="employee":
                linked=conn.execute("SELECT id FROM users WHERE role='approver' AND linked_employee_id=?",(user["id"],)).fetchone()
                user["linked_approver_id"]=linked["id"] if linked else 0
            else:
                user["linked_employee_id"]=int(user.get("linked_employee_id") or 0)
            conn.close(); user.pop("password_hash",None)
            user["annual_leave_entitlement"] = current_year_annual_leave(user["continuous_years"], user.get("hire_date", ""))
            user["medical_period_months"] = medical_period_months(user["continuous_years"], user["unit_years"])
            sick_limit = 60 if user["continuous_years"] < 10 else 90 if user["continuous_years"] < 20 else 120
            user["annual_leave_risk"] = (totals.get("法定病假",0) >= sick_limit or totals.get("事假",0) >= 20)
            user["annual_leave_risk_note"] = "已达到可能取消当年未休年假的阈值，须由公司核实并依法书面确认" if user["annual_leave_risk"] else "未达到病假/事假超限阈值"
            return self.send_json({"user":user,"balances":balances})
        if path == "/api/approval-delegation":
            user=self.require("approver")
            if not user:return
            conn=db()
            delegates=rows(conn.execute("SELECT id,username,name,department FROM users WHERE role='approver' AND id<>?",(user["id"],)))
            current=conn.execute("SELECT d.*,u.name delegate_name,u.username delegate_username FROM approval_delegations d JOIN users u ON u.id=d.delegate_approver_id WHERE d.approver_id=? AND d.status IN ('pending_accept','active','rejected') ORDER BY d.created_at DESC,d.id DESC LIMIT 1",(user["id"],)).fetchone()
            incoming=rows(conn.execute("SELECT d.*,u.name approver_name,u.username approver_username FROM approval_delegations d JOIN users u ON u.id=d.approver_id WHERE d.delegate_approver_id=? AND d.status='pending_accept' ORDER BY d.created_at DESC",(user["id"],)))
            delegated_requests=[]
            today=date.today().isoformat()
            delegated_approvers=[r["approver_id"] for r in conn.execute("SELECT approver_id FROM approval_delegations WHERE delegate_approver_id=? AND status='active' AND start_date<=? AND end_date>=?",(user["id"],today,today)).fetchall()]
            if delegated_approvers:
                marks=",".join("?"*len(delegated_approvers))
                applicant_rows=conn.execute("SELECT id FROM users WHERE approval_approver_id IN (%s)"%marks,tuple(delegated_approvers)).fetchall()
                applicant_ids=[r["id"] for r in applicant_rows]
                if applicant_ids:
                    req_marks=",".join("?"*len(applicant_ids))
                    delegated_requests=rows(conn.execute("SELECT r.id,r.request_no,r.leave_type,r.start_time,r.end_time,r.days,r.status,u.name,u.username FROM leave_requests r JOIN users u ON u.id=r.user_id WHERE r.user_id IN (%s) AND r.status IN ('pending','reported','supplement_required') ORDER BY r.submitted_at DESC"%req_marks,tuple(applicant_ids)))
            conn.close()
            return self.send_json({"delegates":delegates,"current":dict(current) if current else None,"incoming":incoming,"delegated_requests":delegated_requests})
        if path == "/api/policies":
            return self.send_json({"policies":[{"leave_type":k,**v} for k,v in LEAVE_POLICIES.items()]})
        if path == "/api/notifications":
            user=self.require()
            if not user:return
            conn=db();items=rows(conn.execute("""SELECT * FROM notifications WHERE user_id=?
                ORDER BY created_at DESC,id DESC LIMIT 100""",(user["id"],)))
            unread=conn.execute("SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0",(user["id"],)).fetchone()[0]
            conn.close();return self.send_json({"notifications":items,"unread":unread})
        if path == "/api/notifications/unread-count":
            user=self.require()
            if not user:return
            conn=db();unread=conn.execute("SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0",(user["id"],)).fetchone()[0];conn.close()
            return self.send_json({"unread":unread})
        if path == "/api/requests":
            user=self.require();
            if not user:return
            conn=db(); items=rows(conn.execute("SELECT * FROM leave_requests WHERE user_id=? ORDER BY submitted_at DESC",(user['id'],))); conn.close()
            return self.send_json({"requests":items})
        if path.startswith("/api/requests/"):
            user=self.require()
            if not user:return
            try: rid=int(path.rstrip("/").split("/")[-1])
            except ValueError:return self.send_json({"error":"无效申请"},400)
            conn=db(); item=conn.execute("SELECT * FROM leave_requests WHERE id=? AND user_id=?",(rid,user['id'])).fetchone()
            if not item:conn.close();return self.send_json({"error":"申请不存在或无权访问"},404)
            logs=rows(conn.execute("""SELECT l.action,l.comment,l.created_at,l.round,u.name approver_name FROM approval_logs l
                JOIN users u ON u.id=l.approver_id WHERE l.request_id=? ORDER BY l.created_at""",(rid,)))
            detail=dict(item); policy=LEAVE_POLICIES.get(detail["leave_type"],{}); required=policy.get("advance")
            detail["advance_required"]=required; detail["advance_actual"]=advance_workdays(conn,datetime.fromisoformat(detail["submitted_at"]),detail["start_time"])
            detail["timely"]=datetime.fromisoformat(detail["submitted_at"]).date()<=datetime.fromisoformat(detail["start_time"]).date() and (required is None or detail["advance_actual"]>=required)
            detail["timing_rule"]=policy.get("timing",""); detail["material_rule"]=policy.get("material","")
            detail["can_modify"]=detail.get("modification_count",0)<1 and detail["status"] in ("pending","returned","supplement_required","reported")
            adjustments=rows(conn.execute("SELECT * FROM leave_adjustments WHERE request_id=? AND user_id=? ORDER BY submitted_at DESC",(rid,user['id'])))
            for adjustment in adjustments: adjustment["attachments"]=attachment_rows(conn,"adjustment",adjustment["id"])
            attachments=attachment_rows(conn,"request",rid)
            conn.close(); return self.send_json({"request":detail,"logs":logs,"adjustments":adjustments,"attachments":attachments})
        if path == "/api/admin/adjustments":
            user=self.require("approver")
            if not user:return
            conn=db();items=rows(conn.execute("""SELECT a.*,r.request_no,r.leave_type,r.start_time,r.end_time,u.name,u.username,
                CASE WHEN a.status='pending' AND datetime(a.deadline_at)<datetime('now','localtime') THEN 1 ELSE 0 END overdue
                FROM leave_adjustments a JOIN leave_requests r ON r.id=a.request_id JOIN users u ON u.id=a.user_id
                ORDER BY CASE WHEN a.status='pending' THEN 0 ELSE 1 END,a.submitted_at DESC"""))
            for item in items:item["attachments"]=attachment_rows(conn,"adjustment",item["id"])
            conn.close()
            return self.send_json({"adjustments":items})
        if path == "/api/admin/requests":
            user=self.require("approver");
            if not user:return
            all_records = "all=1" in urlparse(self.path).query
            conn=db()
            base_sql = """SELECT r.*,u.name,u.username,u.department,
                CASE WHEN r.status IN ('pending','reported','supplement_required') AND datetime(r.deadline_at)<datetime('now','localtime') THEN 1 ELSE 0 END overdue
                FROM leave_requests r JOIN users u ON u.id=r.user_id"""
            if all_records:
                items=rows(conn.execute(base_sql + " ORDER BY r.submitted_at DESC"))
            else:
                scope=approval_scope_user_ids(conn,user["id"])
                if not scope:
                    conn.close();return self.send_json({"requests":[]})
                marks=",".join("?"*len(scope))
                items=rows(conn.execute(base_sql + " WHERE r.user_id IN (%s) ORDER BY r.submitted_at DESC" % marks, tuple(scope)))
            for item in items:
                policy=LEAVE_POLICIES.get(item["leave_type"],{}); required=policy.get("advance")
                item["advance_required"]=required
                item["advance_actual"]=advance_workdays(conn,datetime.fromisoformat(item["submitted_at"]),item["start_time"])
                item["timely"]=datetime.fromisoformat(item["submitted_at"]).date()<=datetime.fromisoformat(item["start_time"]).date() and (required is None or item["advance_actual"]>=required)
                add_approval_balance(conn,item)
            conn.close()
            return self.send_json({"requests":items})
        if path == "/api/admin/hr-summary":
            user=self.require("approver")
            if not user:return
            conn=db()
            status_counts={r["status"]:r["total"] for r in conn.execute(
                "SELECT status,COUNT(*) total FROM leave_requests GROUP BY status")}
            usage=rows(conn.execute("""SELECT leave_type,COUNT(*) request_count,
                COALESCE(SUM(CASE WHEN status='approved' THEN days ELSE 0 END),0) approved_days,
                COALESCE(SUM(CASE WHEN status IN ('pending','reported','supplement_required') THEN days ELSE 0 END),0) pending_days
                FROM leave_requests GROUP BY leave_type ORDER BY request_count DESC"""))
            employees=conn.execute("SELECT COUNT(*) FROM users WHERE role='employee'").fetchone()[0]
            conn.close();return self.send_json({"employees":employees,"status_counts":status_counts,"usage":usage,
                "policies":[{"leave_type":k,**v} for k,v in LEAVE_POLICIES.items()]})
        if path.startswith("/api/admin/requests/"):
            user=self.require("approver")
            if not user:return
            try: rid=int(path.rstrip("/").split("/")[-1])
            except ValueError:return self.send_json({"error":"无效申请"},400)
            all_records = "all=1" in urlparse(self.path).query
            conn=db()
            item=conn.execute("""SELECT r.*,u.name,u.username,u.gender,u.age,u.unit_years,u.continuous_years,u.department,
                CASE WHEN r.status IN ('pending','reported','supplement_required') AND datetime(r.deadline_at)<datetime('now','localtime') THEN 1 ELSE 0 END overdue
                FROM leave_requests r JOIN users u ON u.id=r.user_id WHERE r.id=?""",(rid,)).fetchone()
            if not item:conn.close();return self.send_json({"error":"申请不存在"},404)
            if not all_records and item["user_id"] not in approval_scope_user_ids(conn,user["id"]):
                conn.close();return self.send_json({"error":"无权查看该申请"},403)
            detail=dict(item); policy=LEAVE_POLICIES.get(detail["leave_type"],{}); required=policy.get("advance")
            add_approval_balance(conn,detail)
            detail["advance_required"]=required; detail["advance_actual"]=advance_workdays(conn,datetime.fromisoformat(detail["submitted_at"]),detail["start_time"])
            detail["timely"]=datetime.fromisoformat(detail["submitted_at"]).date()<=datetime.fromisoformat(detail["start_time"]).date() and (required is None or detail["advance_actual"]>=required); detail["timing_rule"]=policy.get("timing",""); detail["material_rule"]=policy.get("material","")
            logs=rows(conn.execute("""SELECT l.*,u.name approver_name FROM approval_logs l
                JOIN users u ON u.id=l.approver_id WHERE l.request_id=? ORDER BY l.created_at""",(rid,)))
            attachments=attachment_rows(conn,"request",rid)
            adjustments=rows(conn.execute("SELECT * FROM leave_adjustments WHERE request_id=? ORDER BY submitted_at DESC",(rid,)))
            for adjustment in adjustments: adjustment["attachments"]=attachment_rows(conn,"adjustment",adjustment["id"])
            conn.close(); return self.send_json({"request":detail,"logs":logs,"attachments":attachments,"adjustments":adjustments})
        if path.startswith("/api/"): return self.send_json({"error":"接口不存在"},404)
        if path.startswith("/uploads/"):
            user=self.require()
            if not user:return
            name=Path(path).name;conn=db();owner=conn.execute("SELECT user_id FROM attachments WHERE stored_name=?",(name,)).fetchone();conn.close()
            if not owner:return self.send_error(404)
            if user["role"]!="approver" and owner["user_id"]!=user["id"]:return self.send_json({"error":"无权查看该证明材料"},403)
            target=(UPLOADS/name).resolve()
            if target.parent!=UPLOADS.resolve() or not target.exists():return self.send_error(404)
            data=target.read_bytes();self.send_response(200);self.send_header("Content-Type",mimetypes.guess_type(target)[0] or "application/octet-stream")
            self.send_header("Content-Length",str(len(data)));self.send_header("X-Content-Type-Options","nosniff");self.end_headers();self.wfile.write(data);return
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        target=(STATIC/rel).resolve()
        if STATIC.resolve() not in target.parents and target != STATIC.resolve(): return self.send_error(403)
        if not target.exists() or not target.is_file(): target=STATIC/"index.html"
        data=target.read_bytes(); st=target.stat()
        etag='"%x-%x"' % (int(st.st_mtime), st.st_size)
        if self.headers.get("If-None-Match")==etag:
            self.send_response(304); self.send_header("ETag",etag); self.end_headers(); return
        self.send_response(200); self.send_header("Content-Type",mimetypes.guess_type(target)[0] or "application/octet-stream")
        self.send_header("Content-Length",str(len(data)))
        self.send_header("Cache-Control","no-cache")
        self.send_header("ETag",etag)
        self.send_header("Last-Modified",self.date_time_string(int(st.st_mtime)))
        self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        path=urlparse(self.path).path; data=self.body()
        if path == "/api/login":
            conn=db(); user=conn.execute("SELECT * FROM users WHERE username=?",(data.get('username',''),)).fetchone()
            if not user or not verify_password(user["password_hash"],data.get('password','')):
                conn.close();return self.send_json({"error":"账号或密码错误"},401)
            if not str(user["password_hash"]).startswith("$argon2"):
                conn.execute("UPDATE users SET password_hash=? WHERE id=?",(password_hash(data.get('password','')),user["id"]))
            token=secrets.token_urlsafe(32);expires=datetime.now()+timedelta(days=7)
            conn.execute("DELETE FROM sessions WHERE datetime(expires_at)<=datetime('now','localtime')")
            conn.execute("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)",
                (token,user["id"],now_iso(),expires.isoformat(sep=' ',timespec='seconds')))
            conn.commit();conn.close()
            return self.send_json({"ok":True,"role":user['role']},headers={"Set-Cookie":f"session={token}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax"})
        if path == "/api/register":
            required=("username","password","name")
            if any(not str(data.get(k,'')).strip() for k in required): return self.send_json({"error":"请完整填写账号、密码和姓名"},400)
            conn=db()
            try:
                cur=conn.execute("INSERT INTO users(username,password_hash,name,gender,age,unit_years,continuous_years) VALUES(?,?,?,?,?,?,?)",
                    (data['username'].strip(),password_hash(data['password']),data['name'].strip(),data.get('gender',''),int(data.get('age') or 0),float(data.get('unit_years') or 0),float(data.get('continuous_years') or 0)))
                cy=float(data.get('continuous_years') or 0); uy=float(data.get('unit_years') or 0)
                initial={"年休假":annual_leave_days(cy),"事假":20,"丧假":3,"路程假":3,"育儿假":10,"婚假":3,
                    "妇女节假期":.5,"一次性短期病假":2,"护理假":15,
                    "法定病假":medical_period_months(cy,uy)*30}
                if data.get('gender')=='女':initial.update({"产假":98,"奖励假":80})
                if data.get('gender')=='男':initial["陪产假"]=15
                for typ,days in initial.items(): conn.execute("INSERT INTO leave_balances(user_id,leave_type,remaining_days) VALUES(?,?,?)",(cur.lastrowid,typ,days))
                conn.commit()
            except database.IntegrityError: conn.close(); return self.send_json({"error":"该账号已存在"},409)
            conn.close(); return self.send_json({"ok":True})
        if path == "/api/logout":
            jar=cookies.SimpleCookie(self.headers.get("Cookie")); token=jar.get("session")
            if token:
                conn=db();conn.execute("DELETE FROM sessions WHERE token=?",(token.value,));conn.commit();conn.close()
            return self.send_json({"ok":True},headers={"Set-Cookie":"session=; Path=/; Max-Age=0"})
        if path == "/api/upload":
            user=self.require()
            if not user:return
            mime=str(data.get("mime_type","")); allowed={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif"}
            if mime not in allowed:return self.send_json({"error":"仅支持 JPG、PNG、WebP 或 GIF 图片"},400)
            encoded=str(data.get("data","")); encoded=encoded.split(",",1)[-1]
            try:content=base64.b64decode(encoded,validate=True)
            except Exception:return self.send_json({"error":"图片数据无效"},400)
            if not content or len(content)>8*1024*1024:return self.send_json({"error":"单张图片不能超过8MB"},400)
            token=secrets.token_urlsafe(18);stored=f"{secrets.token_hex(16)}.{allowed[mime]}";(UPLOADS/stored).write_bytes(content)
            original=Path(str(data.get("filename","图片"))).name[:180]
            conn=db();conn.execute("""INSERT INTO attachments(token,user_id,original_name,stored_name,mime_type,size,created_at)
                VALUES(?,?,?,?,?,?,?)""",(token,user['id'],original,stored,mime,len(content),now_iso()));conn.commit();conn.close()
            return self.send_json({"token":token,"name":original,"url":"/uploads/"+stored},201)
        if path == "/api/change-password":
            user=self.require()
            if not user:return
            current=str(data.get("current_password","")); new=str(data.get("new_password",""))
            if not verify_password(user["password_hash"],current):return self.send_json({"error":"当前密码不正确"},400)
            if len(new)<6:return self.send_json({"error":"新密码至少需要6个字符"},400)
            if new==current:return self.send_json({"error":"新密码不能与当前密码相同"},400)
            conn=db();conn.execute("UPDATE users SET password_hash=? WHERE id=?",(password_hash(new),user['id']));conn.commit();conn.close()
            return self.send_json({"ok":True})
        if path == "/api/approval-delegation":
            user=self.require("approver")
            if not user:return
            try: delegate_id=int(data.get("delegate_approver_id") or 0)
            except ValueError: delegate_id=0
            conn=db()
            if delegate_id:
                if delegate_id==user["id"]:
                    conn.close();return self.send_json({"error":"不能委托自己为代理人"},400)
                delegate=conn.execute("SELECT id FROM users WHERE id=? AND role='approver'",(delegate_id,)).fetchone()
                if not delegate:
                    conn.close();return self.send_json({"error":"代理人必须是审批员"},400)
            try:
                start_date=date.fromisoformat(str(data.get("start_date",""))).isoformat()
                end_date=date.fromisoformat(str(data.get("end_date",""))).isoformat()
                if end_date < start_date:
                    conn.close();return self.send_json({"error":"结束日期不能早于开始日期"},400)
            except Exception:
                conn.close();return self.send_json({"error":"请填写有效的生效日期"},400)
            if not delegate_id:
                conn.execute("UPDATE approval_delegations SET status='inactive' WHERE approver_id=? AND status IN ('active','pending_accept','rejected')",(user["id"],))
            else:
                conn.execute("INSERT INTO approval_delegations(approver_id,delegate_approver_id,start_date,end_date,reason,status,created_at) VALUES(?,?,?,?,?,?,?)",
                    (user["id"],delegate_id,start_date,end_date,str(data.get("reason","")).strip(),"pending_accept",now_iso()))
                notify_user(conn,delegate_id,"收到审批代理请求","有审批员委托你在指定时间段代为审批，请前往“审批代理”确认。",0,"delegation")
            conn.commit();conn.close()
            return self.send_json({"ok":True})
        if path == "/api/approval-delegation/respond":
            user=self.require("approver")
            if not user:return
            try: delegation_id=int(data.get("delegation_id") or 0)
            except ValueError: delegation_id=0
            action=str(data.get("action") or "")
            if action not in ("accept","reject") or not delegation_id:
                return self.send_json({"error":"参数无效"},400)
            conn=db()
            delegation=conn.execute("SELECT * FROM approval_delegations WHERE id=? AND delegate_approver_id=?",(delegation_id,user["id"])).fetchone()
            if not delegation:
                conn.close();return self.send_json({"error":"委托请求不存在"},404)
            if delegation["status"]!="pending_accept":
                conn.close();return self.send_json({"error":"该委托已处理"},409)
            if action=="accept":
                conn.execute("UPDATE approval_delegations SET status='inactive' WHERE approver_id=? AND status='active' AND id<>?",(delegation["approver_id"],delegation_id))
                conn.execute("UPDATE approval_delegations SET status='active' WHERE id=?",(delegation_id,))
                notify_user(conn,delegation["approver_id"],"审批代理已生效","你设置的审批代理人已确认接受委托。",0,"delegation")
            else:
                conn.execute("UPDATE approval_delegations SET status='rejected' WHERE id=?",(delegation_id,))
                notify_user(conn,delegation["approver_id"],"审批代理已拒绝","你设置的审批代理人已拒绝该委托。",0,"delegation")
            conn.commit();conn.close()
            return self.send_json({"ok":True})
        if path == "/api/switch-employee":
            user=self.require()
            if not user:return
            target_id=0
            if user["role"]=="approver":
                target_id=int(user.get("linked_employee_id") or 0)
            else:
                conn=db()
                linked=conn.execute("SELECT id FROM users WHERE role='approver' AND linked_employee_id=?",(user["id"],)).fetchone()
                if linked:
                    target_id=int(linked["id"])
                conn.close()
            if not target_id:
                return self.send_json({"error":"当前账号未关联另一个身份账号"},400)
            conn=db()
            target=conn.execute("SELECT id FROM users WHERE id=?",(target_id,)).fetchone()
            if not target:
                conn.close();return self.send_json({"error":"关联账号不存在"},404)
            token=secrets.token_urlsafe(32); expires=datetime.now()+timedelta(days=7)
            conn.execute("DELETE FROM sessions WHERE datetime(expires_at)<=datetime('now','localtime')")
            conn.execute("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)",(token,target_id,now_iso(),expires.isoformat(sep=' ',timespec='seconds')))
            conn.commit();conn.close()
            return self.send_json({"ok":True},headers={"Set-Cookie":f"session={token}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax"})
        if path == "/api/notifications/read":
            user=self.require()
            if not user:return
            conn=db();nid=data.get("id");request_id=data.get("request_id")
            if nid:conn.execute("UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?",(nid,user["id"]))
            elif request_id:conn.execute("UPDATE notifications SET is_read=1 WHERE request_id=? AND user_id=?",(request_id,user["id"]))
            else:conn.execute("UPDATE notifications SET is_read=1 WHERE user_id=?",(user["id"],))
            conn.commit();conn.close();return self.send_json({"ok":True})
        if path == "/api/calculate-days":
            user=self.require()
            if not user:return
            typ=data.get("leave_type"); policy=LEAVE_POLICIES.get(typ)
            if not policy:return self.send_json({"error":"未知的请假类型"},400)
            try:
                conn=db(); days=leave_days(conn,data["start_time"],data["end_time"],policy["unit"])
                actual_advance=advance_workdays(conn,datetime.now(),data["start_time"])
                if typ=="妇女节假期": days=.5
                calc_warnings=[]
                if policy.get("max_per_request") and days>policy["max_per_request"]:
                    calc_warnings.append(f"{typ}单次原则上不超过 {policy['max_per_request']} 天，当前为 {days:g} 天")
                year=str(datetime.fromisoformat(data["start_time"].replace("T"," ")).year)
                used=conn.execute("""SELECT COALESCE(SUM(days),0),COUNT(*) FROM leave_requests
                    WHERE user_id=? AND leave_type=? AND substr(start_time,1,4)=? AND status NOT IN ('rejected','returned')""",(user['id'],typ,year)).fetchone()
                if policy.get("annual_limit") and used[0]+days>policy["annual_limit"]:
                    calc_warnings.append(f"本期已申请 {used[0]:g} 天，本次申请后将超过 {policy['annual_limit']} 天原则额度")
                if policy.get("max_uses") and used[1]+1>policy["max_uses"]:
                    calc_warnings.append(f"本期已申请 {used[1]} 次，本次将超过原则上的 {policy['max_uses']} 次")
                if typ in ("产假","奖励假") and user.get("gender")!="女": calc_warnings.append("该假期仅适用于符合条件的女性员工")
                if typ=="陪产假" and user.get("gender")!="男": calc_warnings.append("陪产假仅适用于符合条件的男性员工")
                if typ=="路程假": calc_warnings.append("必须关联本人婚假或丧假申请，且两个假期日期连续")
                if typ=="奖励假": calc_warnings.append("原则上须关联本人产假申请并连续安排")
                conn.close()
                required=policy.get("advance")
                not_retroactive=datetime.fromisoformat(data["start_time"].replace("T"," ")).date()>=date.today()
                return self.send_json({"days":days,"unit":policy["unit"],"policy":policy["limit"],"advance_required":required,
                    "advance_actual":actual_advance,"timely":not_retroactive and (required is None or actual_advance>=required),"timing":policy.get("timing",""),"material":policy.get("material","") ,"principle_warnings":calc_warnings})
            except Exception as exc:return self.send_json({"error":str(exc) or "日期计算失败"},400)
        if path == "/api/requests":
            user=self.require();
            if not user:return
            try:
                typ=data['leave_type']; policy=LEAVE_POLICIES[typ]; start=data['start_time'].replace('T',' '); end=data['end_time'].replace('T',' ')
                conn=db(); calculated=leave_days(conn,start,end,policy["unit"]); days=.5 if typ=="妇女节假期" else calculated
                if days <= 0: raise ValueError("所选日期不包含工作日")
            except Exception as exc:
                try: conn.close()
                except Exception: pass
                return self.send_json({"error":str(exc) or "请填写有效的请假类型和时间"},400)
            year=str(datetime.fromisoformat(start).year)
            used=conn.execute("""SELECT COALESCE(SUM(days),0),COUNT(*) FROM leave_requests
                WHERE user_id=? AND leave_type=? AND substr(start_time,1,4)=? AND status NOT IN ('rejected','returned')""",(user['id'],typ,year)).fetchone()
            warnings=[]; exception_requested=int(bool(data.get('exception_requested')))
            actual_advance=advance_workdays(conn,datetime.now(),start); required_advance=policy.get("advance")
            retrospective=datetime.fromisoformat(start).date()<date.today()
            if (retrospective or (required_advance is not None and actual_advance<required_advance)) and not data.get('emergency_report'):
                timing_error = "申请日期已晚于休假开始日期" if retrospective else f"该假期原则上需提前 {required_advance} 个工作日申请，当前仅提前 {actual_advance} 个工作日"
                conn.close(); return self.send_json({"error":timing_error+"。请调整日期；如属突发或紧急情况，请勾选突发情况报备并说明原因。","timeliness":False},400)
            if (retrospective or (required_advance is not None and actual_advance<required_advance)) and data.get('emergency_report') and not str(data.get('emergency_reason','')).strip():
                conn.close(); return self.send_json({"error":"未按标准时限申请时，请填写突发或紧急情况的报备原因。"},400)
            if policy.get("max_per_request") and days>policy["max_per_request"]: warnings.append(f"单次超过制度标准 {policy['max_per_request']} 天")
            if policy.get("annual_limit") and used[0]+days>policy["annual_limit"]: warnings.append(f"本期累计将超过 {policy['annual_limit']} 天")
            if policy.get("max_uses") and used[1]+1>policy["max_uses"]: warnings.append(f"本期申请次数将超过 {policy['max_uses']} 次")
            if typ in ("产假","奖励假") and user.get("gender")!="女":
                conn.close(); return self.send_json({"error":"该假期仅适用于符合条件的女性员工。"},400)
            if typ=="陪产假" and user.get("gender")!="男":
                conn.close(); return self.send_json({"error":"陪产假仅适用于符合条件的男性员工。"},400)
            related_no=str(data.get("related_request_no","")).strip()
            if typ=="路程假":
                if not related_no:
                    conn.close(); return self.send_json({"error":"路程假必须与婚假或丧假一并申请，请填写对应申请单号。"},400)
                related=conn.execute("SELECT * FROM leave_requests WHERE request_no=? AND user_id=?",(related_no,user['id'])).fetchone()
                if not related or related["leave_type"] not in ("婚假","丧假"):
                    conn.close(); return self.send_json({"error":"关联申请必须是本人有效的婚假或丧假申请。"},400)
                related_start=datetime.fromisoformat(related["start_time"]).date(); related_end=datetime.fromisoformat(related["end_time"]).date()
                this_start=datetime.fromisoformat(start).date(); this_end=datetime.fromisoformat(end).date()
                if this_end+timedelta(days=1)!=related_start and related_end+timedelta(days=1)!=this_start:
                    conn.close(); return self.send_json({"error":"路程假必须与关联的婚假或丧假连续安排，两个假期日期不能间断。"},400)
            if typ=="奖励假":
                if not related_no: warnings.append("奖励假原则上应关联产假申请并连续安排")
                else:
                    related=conn.execute("SELECT * FROM leave_requests WHERE request_no=? AND user_id=?",(related_no,user['id'])).fetchone()
                    if not related or related["leave_type"]!="产假": warnings.append("所填关联单不是本人的产假申请")
                    else:
                        related_end=datetime.fromisoformat(related["end_time"]).date(); this_start=datetime.fromisoformat(start).date()
                        if related_end+timedelta(days=1)!=this_start: warnings.append("奖励假与产假未连续安排")
            if warnings and not exception_requested:
                conn.close(); return self.send_json({"error":"不符合以下原则性要求："+"；".join(warnings)+"。请调整申请；确有特殊情况时，可勾选“不符合原则性要求，申请特殊审批”并在事由中说明。","warnings":warnings},400)
            seq=conn.execute("SELECT COUNT(*)+1 FROM leave_requests").fetchone()[0]; req_no=f"QJ{date.today():%Y%m%d}{seq:03d}"
            exempt_material=policy.get("reason_required") is False
            reason="" if exempt_material else data.get('reason','')
            material="complete" if exempt_material else ("pending" if data.get('pending_material') else "complete")
            material_note="" if exempt_material else data.get('material_note','')
            attachment_tokens=[] if exempt_material else data.get("attachment_tokens",[])
            status="reported" if data.get('emergency_report') else "pending"
            now=datetime.now(); deadline=now+timedelta(days=1)
            cur=conn.execute("""INSERT INTO leave_requests(user_id,request_no,leave_type,start_time,end_time,days,reason,material_status,material_note,
              emergency_report,emergency_reason,status,submitted_at,updated_at,deadline_at,policy_unit,exception_requested,related_request_no)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
              (user['id'],req_no,typ,start,end,days,reason,material,material_note,int(bool(data.get('emergency_report'))),data.get('emergency_reason',''),status,now_iso(),now_iso(),deadline.isoformat(sep=' ',timespec='seconds'),policy['unit'],exception_requested,data.get('related_request_no','')))
            bind_attachments(conn,attachment_tokens,user['id'],"request",cur.lastrowid)
            notify_approvers(conn,"收到新的请假申请",f"{user['name']} 提交了 {typ} 申请（{req_no}）",cur.lastrowid,"leave",user['id'])
            conn.commit(); conn.close(); return self.send_json({"ok":True,"request_no":req_no},201)
        if path.startswith("/api/requests/") and path.endswith("/adjustments"):
            user=self.require()
            if not user:return
            try: rid=int(path.split('/')[3])
            except ValueError:return self.send_json({"error":"无效申请"},400)
            typ=data.get("adjustment_type"); proposed=str(data.get("proposed_time","")).replace("T"," ")
            if typ not in ("return","extension") or not proposed:return self.send_json({"error":"请选择销假或续假类型并填写时间"},400)
            conn=db();req=conn.execute("SELECT * FROM leave_requests WHERE id=? AND user_id=?",(rid,user['id'])).fetchone()
            if not req:conn.close();return self.send_json({"error":"申请不存在或无权操作"},404)
            if req["status"]!="approved":conn.close();return self.send_json({"error":"只有已通过的请假申请才能办理销假或续假"},409)
            if conn.execute("SELECT 1 FROM leave_adjustments WHERE request_id=? AND status='pending'",(rid,)).fetchone():conn.close();return self.send_json({"error":"该申请已有待审批的返岗或续假手续"},409)
            try:
                proposed_dt=datetime.fromisoformat(proposed);start_dt=datetime.fromisoformat(req["start_time"]);end_dt=datetime.fromisoformat(req["end_time"])
            except ValueError:conn.close();return self.send_json({"error":"时间格式无效"},400)
            if typ=="return" and not (start_dt<=proposed_dt<end_dt):conn.close();return self.send_json({"error":"提前返岗时间必须在原请假开始时间与结束时间之间"},400)
            if typ=="extension" and proposed_dt<=end_dt:conn.close();return self.send_json({"error":"续假结束时间必须晚于原批准结束时间"},400)
            if typ=="extension" and datetime.now()>end_dt:conn.close();return self.send_json({"error":"续假必须在原批准假期届满前提出；当前已超过办理时间"},400)
            reason=str(data.get("reason","")).strip()
            if not reason:conn.close();return self.send_json({"error":"请如实填写销假或续假原因"},400)
            now=datetime.now();cur=conn.execute("""INSERT INTO leave_adjustments(request_id,user_id,adjustment_type,proposed_time,reason,
                material_status,material_note,status,submitted_at,updated_at,deadline_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (rid,user['id'],typ,proposed,reason,"pending" if data.get("pending_material") else "complete",data.get("material_note",""),
                 "pending",now_iso(),now_iso(),(now+timedelta(days=1)).isoformat(sep=' ',timespec='seconds')))
            bind_attachments(conn,data.get("attachment_tokens",[]),user['id'],"adjustment",cur.lastrowid)
            adjustment_name="提前返岗 / 销假" if typ=="return" else "续假"
            notify_approvers(conn,f"收到{adjustment_name}申请",f"{user['name']} 对 {req['request_no']} 提交了{adjustment_name}手续",rid,"adjustment",user['id'])
            conn.commit();conn.close();return self.send_json({"ok":True},201)
        if path.startswith("/api/requests/") and path.endswith("/update"):
            user=self.require()
            if not user:return
            try: rid=int(path.split('/')[3])
            except ValueError:return self.send_json({"error":"无效申请"},400)
            conn=db(); old=conn.execute("SELECT * FROM leave_requests WHERE id=? AND user_id=?",(rid,user['id'])).fetchone()
            if not old:conn.close();return self.send_json({"error":"申请不存在或无权修改"},404)
            if old["modification_count"]>=1:conn.close();return self.send_json({"error":"该申请已使用过一次修改机会，不能再次修改"},409)
            if old["status"] not in ("pending","returned","supplement_required","reported"):
                conn.close();return self.send_json({"error":"当前审批状态不允许修改"},409)
            try:
                typ=data['leave_type']; policy=LEAVE_POLICIES[typ]; start=data['start_time'].replace('T',' '); end=data['end_time'].replace('T',' ')
                days=leave_days(conn,start,end,policy["unit"])
                if days<=0:raise ValueError("所选日期不包含工作日")
            except Exception as exc:conn.close();return self.send_json({"error":str(exc) or "请填写有效的请假信息"},400)
            emergency=bool(data.get("emergency_report")); actual=advance_workdays(conn,datetime.now(),start); required=policy.get("advance")
            late=datetime.fromisoformat(start).date()<date.today() or (required is not None and actual<required)
            if late and not emergency:conn.close();return self.send_json({"error":"修改后的日期不符合提前申请时限；如属突发情况，请勾选报备并说明原因"},400)
            if late and not str(data.get("emergency_reason","")).strip():conn.close();return self.send_json({"error":"请填写突发或紧急情况的报备原因"},400)
            year=str(datetime.fromisoformat(start).year)
            used=conn.execute("""SELECT COALESCE(SUM(days),0),COUNT(*) FROM leave_requests WHERE user_id=? AND leave_type=?
                AND substr(start_time,1,4)=? AND id<>? AND status NOT IN ('rejected','returned')""",(user['id'],typ,year,rid)).fetchone()
            warnings=[]
            if policy.get("max_per_request") and days>policy["max_per_request"]:warnings.append(f"单次超过 {policy['max_per_request']} 天")
            if policy.get("annual_limit") and used[0]+days>policy["annual_limit"]:warnings.append(f"本期累计超过 {policy['annual_limit']} 天")
            if policy.get("max_uses") and used[1]+1>policy["max_uses"]:warnings.append(f"本期申请次数超过 {policy['max_uses']} 次")
            if warnings and not data.get("exception_requested"):conn.close();return self.send_json({"error":"不符合原则性要求："+"；".join(warnings)},400)
            related_no=str(data.get("related_request_no","")).strip()
            if typ=="路程假":
                related=conn.execute("SELECT * FROM leave_requests WHERE request_no=? AND user_id=?",(related_no,user['id'])).fetchone()
                if not related or related["leave_type"] not in ("婚假","丧假"):conn.close();return self.send_json({"error":"路程假必须关联本人婚假或丧假申请"},400)
                rs,re=datetime.fromisoformat(related["start_time"]).date(),datetime.fromisoformat(related["end_time"]).date(); ts,te=datetime.fromisoformat(start).date(),datetime.fromisoformat(end).date()
                if te+timedelta(days=1)!=rs and re+timedelta(days=1)!=ts:conn.close();return self.send_json({"error":"路程假必须与关联假期连续安排"},400)
            exempt_material=policy.get("reason_required") is False
            reason="" if exempt_material else data.get("reason","")
            material_status="complete" if exempt_material else ("pending" if data.get("pending_material") else "complete")
            material_note="" if exempt_material else data.get("material_note","")
            attachment_tokens=[] if exempt_material else data.get("attachment_tokens",[])
            new_status="reported" if emergency else "pending"
            conn.execute("""UPDATE leave_requests SET leave_type=?,start_time=?,end_time=?,days=?,reason=?,material_status=?,material_note=?,
                emergency_report=?,emergency_reason=?,status=?,review_round=review_round+1,updated_at=?,policy_unit=?,exception_requested=?,
                related_request_no=?,modification_count=modification_count+1,approver_comment='' WHERE id=?""",
                (typ,start,end,days,reason,material_status,material_note,
                 int(emergency),data.get("emergency_reason",""),new_status,now_iso(),policy["unit"],int(bool(data.get("exception_requested"))),related_no,rid))
            bind_attachments(conn,attachment_tokens,user['id'],"request",rid)
            notify_approvers(conn,"请假申请已重新提交",f"{user['name']} 修改并重新提交了 {old['request_no']}",rid,"leave",user['id'])
            conn.commit();conn.close();return self.send_json({"ok":True,"request_no":old["request_no"],"review_round":old["review_round"]+1})
        if path.startswith("/api/admin/adjustments/") and path.endswith("/action"):
            user=self.require("approver")
            if not user:return
            try: aid=int(path.split('/')[4])
            except ValueError:return self.send_json({"error":"无效手续"},400)
            action=data.get("action"); mapping={"approve":"approved","return":"returned","supplement":"supplement_required","reject":"rejected"}
            if action not in mapping:return self.send_json({"error":"无效操作"},400)
            conn=db();adj=conn.execute("SELECT * FROM leave_adjustments WHERE id=?",(aid,)).fetchone()
            if not adj:conn.close();return self.send_json({"error":"手续不存在"},404)
            if adj["user_id"]==user["id"]:conn.close();return self.send_json({"error":"不能审批自己的请假手续"},403)
            if adj["status"]!="pending":conn.close();return self.send_json({"error":"该手续已处理"},409)
            comment=str(data.get("comment","")).strip()
            if action=="reject" and not comment:conn.close();return self.send_json({"error":"选择不通过时必须填写缘由"},400)
            new_status=mapping[action]
            conn.execute("UPDATE leave_adjustments SET status=?,approver_comment=?,updated_at=? WHERE id=?",(new_status,comment,now_iso(),aid))
            conn.execute("INSERT INTO adjustment_logs(adjustment_id,approver_id,action,comment,created_at) VALUES(?,?,?,?,?)",(aid,user['id'],action,comment,now_iso()))
            if action=="approve":
                req=conn.execute("SELECT * FROM leave_requests WHERE id=?",(adj["request_id"],)).fetchone(); policy=LEAVE_POLICIES.get(req["leave_type"],{"unit":"自然日"})
                new_days=leave_days(conn,req["start_time"],adj["proposed_time"],policy["unit"]);delta=new_days-req["days"]
                conn.execute("UPDATE leave_requests SET end_time=?,days=?,updated_at=? WHERE id=?",(adj["proposed_time"],new_days,now_iso(),req["id"]))
                conn.execute("UPDATE leave_balances SET remaining_days=MAX(0,remaining_days-?) WHERE user_id=? AND leave_type=?",(delta,req["user_id"],req["leave_type"]))
            adjustment_name="提前返岗 / 销假" if adj["adjustment_type"]=="return" else "续假"
            action_text={"approve":"已通过","return":"已退回修改","supplement":"需要补充材料","reject":"不通过"}[action]
            notify_user(conn,adj["user_id"],f"{adjustment_name}审批更新",f"您的{adjustment_name}申请{action_text}。{comment}",adj["request_id"],"adjustment")
            conn.commit();conn.close();return self.send_json({"ok":True})
        if path.startswith("/api/admin/requests/") and path.endswith("/action"):
            user=self.require("approver");
            if not user:return
            try: rid=int(path.split('/')[4])
            except:return self.send_json({"error":"无效申请"},400)
            action=data.get('action'); mapping={"approve":"approved","reject":"rejected","return":"returned","supplement":"supplement_required","remind":"supplement_required"}
            if action not in mapping:return self.send_json({"error":"无效操作"},400)
            comment=str(data.get('comment','')).strip()
            if action in ('reject','remind') and not comment:return self.send_json({"error":"该操作需要填写留言"},400)
            conn=db(); req=conn.execute("SELECT * FROM leave_requests WHERE id=?",(rid,)).fetchone()
            if not req:conn.close();return self.send_json({"error":"申请不存在"},404)
            if req["user_id"]==user["id"]:conn.close();return self.send_json({"error":"不能审批自己的请假申请"},403)
            if req["user_id"] not in approval_scope_user_ids(conn,user["id"]):
                conn.close();return self.send_json({"error":"该申请不在你的审批范围内"},403)
            if req["status"] not in ("pending","reported","supplement_required"):
                conn.close();return self.send_json({"error":"该申请已处理，不能重复审批"},409)
            if action=="approve":
                balance_check=dict(req);add_approval_balance(conn,balance_check)
                if not balance_check["balance_sufficient"]:
                    available=balance_check["available_balance"]
                    conn.close();return self.send_json({"error":f"当前可用余额仅 {available:g} 天，不足以批准本次 {req['days']:g} 天申请"},409)
            new_status=mapping[action]
            conn.execute("UPDATE leave_requests SET status=?,approver_comment=?,updated_at=? WHERE id=?",(new_status,comment,now_iso(),rid))
            conn.execute("INSERT INTO approval_logs(request_id,approver_id,action,comment,created_at,round) VALUES(?,?,?,?,?,?)",(rid,user['id'],action,comment,now_iso(),req['review_round']))
            if action=='approve':
                balance_type={"病假":"法定病假"}.get(req['leave_type'],req['leave_type'])
                conn.execute("UPDATE leave_balances SET remaining_days=MAX(0,remaining_days-?) WHERE user_id=? AND leave_type=?",(req['days'],req['user_id'],balance_type))
            action_text={"approve":"已通过","reject":"不通过","return":"已退回修改","supplement":"需要补充材料","remind":"收到补交材料提醒"}[action]
            notify_user(conn,req["user_id"],f"{req['leave_type']}申请状态更新",f"申请单 {req['request_no']} {action_text}。{comment}",rid)
            conn.commit(); conn.close(); return self.send_json({"ok":True})
        return self.send_json({"error":"接口不存在"},404)


if __name__ == "__main__":
    init_db(); port=int(os.environ.get("PORT","8000")); host=os.environ.get("HOST","0.0.0.0")
    print(f"请假系统已启动：http://127.0.0.1:{port}（局域网请使用本机 IP）")
    ThreadingHTTPServer((host,port),Handler).serve_forever()
