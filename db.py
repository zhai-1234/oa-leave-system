# -*- coding: utf-8 -*-
"""SQLite / MySQL 双后端兼容层。

默认仍使用 SQLite，保证本地和现有测试无需改动。
切换到 MySQL 时，需要先安装 pymysql，并配置：
  LEAVE_DB_BACKEND=mysql
  MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
"""
import os
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("LEAVE_DB_PATH", ROOT / "leave_system.db"))
BACKEND = os.environ.get("LEAVE_DB_BACKEND", "sqlite").strip().lower()

IntegrityError = sqlite3.IntegrityError
OperationalError = sqlite3.OperationalError


def _mysql_module():
    try:
        import pymysql
        import pymysql.cursors
        import pymysql.err
        return pymysql
    except ImportError:
        return None


if BACKEND == "mysql":
    _pymysql = _mysql_module()
    if _pymysql is not None:
        IntegrityError = _pymysql.err.IntegrityError
        OperationalError = _pymysql.err.OperationalError


def _mysql_config():
    return {
        "host": os.environ.get("MYSQL_HOST", "127.0.0.1"),
        "port": int(os.environ.get("MYSQL_PORT", "3306")),
        "user": os.environ.get("MYSQL_USER", "root"),
        "password": os.environ.get("MYSQL_PASSWORD", ""),
        "database": os.environ.get("MYSQL_DATABASE", "leave_system"),
        "charset": os.environ.get("MYSQL_CHARSET", "utf8mb4"),
    }


def _translate_mysql(sql):
    sql = sql.replace("?", "%s")
    sql = re.sub(r"\bINSERT\s+OR\s+IGNORE\b", "INSERT IGNORE", sql, flags=re.I)
    sql = sql.replace("datetime('now','localtime')", "NOW()")
    sql = re.sub(r"datetime\(([a-zA-Z_][\w.]*)\)\s*<\s*NOW\(\)", r"\1 < NOW()", sql)
    sql = re.sub(r"datetime\(([a-zA-Z_][\w.]*)\)\s*>\s*NOW\(\)", r"\1 > NOW()", sql)
    sql = re.sub(r"datetime\(([a-zA-Z_][\w.]*)\)\s*<=\s*NOW\(\)", r"\1 <= NOW()", sql)
    sql = re.sub(r"datetime\(([a-zA-Z_][\w.]*)\)\s*>=\s*NOW\(\)", r"\1 >= NOW()", sql)
    return sql


class Row(dict):
    def __init__(self, *args, _keys=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._keys = list(_keys or self.keys())

    def __getitem__(self, key):
        if isinstance(key, int):
            return super().__getitem__(self._keys[key])
        return super().__getitem__(key)


class _MySQLCursor:
    def __init__(self, cursor):
        self._cursor = cursor

    @property
    def lastrowid(self):
        return self._cursor.lastrowid

    @property
    def rowcount(self):
        return self._cursor.rowcount

    def execute(self, sql, params=None):
        self._cursor.execute(_translate_mysql(sql), params or ())
        return self

    def executemany(self, sql, params):
        self._cursor.executemany(_translate_mysql(sql), params)
        return self

    def fetchone(self):
        row = self._cursor.fetchone()
        return Row(row, _keys=list(row.keys())) if row else None

    def fetchall(self):
        return [Row(r, _keys=list(r.keys())) for r in self._cursor.fetchall()]

    def __iter__(self):
        for row in self._cursor.fetchall():
            yield Row(row, _keys=list(row.keys()))


class _MySQLConnection:
    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql, params=None):
        cur = self._conn.cursor()
        return _MySQLCursor(cur).execute(sql, params)

    def executemany(self, sql, params):
        cur = self._conn.cursor()
        return _MySQLCursor(cur).executemany(sql, params)

    def commit(self):
        return self._conn.commit()

    def rollback(self):
        return self._conn.rollback()

    def close(self):
        return self._conn.close()


def connect():
    if BACKEND == "mysql":
        pymysql = _mysql_module()
        if pymysql is None:
            raise RuntimeError("MySQL 后端需要 pymysql：pip install pymysql")
        cfg = _mysql_config()
        conn = pymysql.connect(
            host=cfg["host"], port=cfg["port"], user=cfg["user"],
            password=cfg["password"], database=cfg["database"],
            charset=cfg["charset"], cursorclass=pymysql.cursors.DictCursor,
            autocommit=False,
        )
        return _MySQLConnection(conn)

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


SQLITE_SCHEMA = '''
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  gender TEXT DEFAULT '', age INTEGER DEFAULT 0,
  unit_years REAL DEFAULT 0, continuous_years REAL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'employee' CHECK(role IN ('employee','approver'))
);
CREATE TABLE IF NOT EXISTS leave_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
  leave_type TEXT NOT NULL, remaining_days REAL NOT NULL DEFAULT 0,
  UNIQUE(user_id, leave_type), FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
  request_no TEXT UNIQUE NOT NULL, leave_type TEXT NOT NULL,
  start_time TEXT NOT NULL, end_time TEXT NOT NULL, days REAL NOT NULL,
  reason TEXT DEFAULT '', material_status TEXT NOT NULL DEFAULT 'complete',
  material_note TEXT DEFAULT '', emergency_report INTEGER DEFAULT 0,
  emergency_reason TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
  review_round INTEGER DEFAULT 1, submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, deadline_at TEXT, approver_comment TEXT DEFAULT '',
  resubmit_reason TEXT DEFAULT '', FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS approval_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL,
  approver_id INTEGER NOT NULL, action TEXT NOT NULL, comment TEXT DEFAULT '',
  created_at TEXT NOT NULL, round INTEGER DEFAULT 1,
  FOREIGN KEY(request_id) REFERENCES leave_requests(id),
  FOREIGN KEY(approver_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS calendar_days (
  holiday_date TEXT PRIMARY KEY,
  day_type TEXT NOT NULL CHECK(day_type IN ('holiday','workday')),
  name TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS leave_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  adjustment_type TEXT NOT NULL CHECK(adjustment_type IN ('return','extension')),
  proposed_time TEXT NOT NULL, reason TEXT DEFAULT '',
  material_status TEXT NOT NULL DEFAULT 'complete', material_note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', submitted_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  deadline_at TEXT, approver_comment TEXT DEFAULT '', review_round INTEGER DEFAULT 1,
  FOREIGN KEY(request_id) REFERENCES leave_requests(id), FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS adjustment_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, adjustment_id INTEGER NOT NULL, approver_id INTEGER NOT NULL,
  action TEXT NOT NULL, comment TEXT DEFAULT '', created_at TEXT NOT NULL,
  FOREIGN KEY(adjustment_id) REFERENCES leave_adjustments(id), FOREIGN KEY(approver_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE NOT NULL, user_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'pending', entity_id INTEGER NOT NULL DEFAULT 0,
  original_name TEXT NOT NULL, stored_name TEXT NOT NULL, mime_type TEXT NOT NULL,
  size INTEGER NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
  title TEXT NOT NULL, message TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'leave',
  request_id INTEGER DEFAULT 0, is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS approval_delegations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  approver_id INTEGER NOT NULL,
  delegate_approver_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  FOREIGN KEY(approver_id) REFERENCES users(id),
  FOREIGN KEY(delegate_approver_id) REFERENCES users(id)
);
'''

MYSQL_TABLES = [
    '''CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(64) NOT NULL,
  gender VARCHAR(16) DEFAULT '',
  age INT DEFAULT 0,
  unit_years DOUBLE DEFAULT 0,
  continuous_years DOUBLE DEFAULT 0,
  role VARCHAR(16) NOT NULL DEFAULT 'employee',
  hire_date VARCHAR(16) DEFAULT '',
  youngest_child_birthdate VARCHAR(16) DEFAULT '',
  parent_care_eligible TINYINT DEFAULT 0,
  department VARCHAR(64) DEFAULT '综合管理部',
  linked_employee_id INT DEFAULT 0,
  approval_approver_id INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4''',
    '''CREATE TABLE IF NOT EXISTS leave_balances (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  leave_type VARCHAR(64) NOT NULL,
  remaining_days DOUBLE NOT NULL DEFAULT 0,
  UNIQUE KEY uq_user_leave (user_id, leave_type),
  CONSTRAINT fk_lb_user FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4''',
    '''CREATE TABLE IF NOT EXISTS leave_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  request_no VARCHAR(64) UNIQUE NOT NULL,
  leave_type VARCHAR(64) NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  days DOUBLE NOT NULL,
  reason TEXT,
  material_status VARCHAR(24) NOT NULL DEFAULT 'complete',
  material_note TEXT,
  emergency_report TINYINT DEFAULT 0,
  emergency_reason TEXT,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  review_round INT DEFAULT 1,
  submitted_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deadline_at DATETIME NULL,
  approver_comment TEXT,
  resubmit_reason TEXT,
  policy_unit VARCHAR(16) DEFAULT '',
  exception_requested TINYINT DEFAULT 0,
  related_request_no VARCHAR(64) DEFAULT '',
  modification_count INT DEFAULT 0,
  CONSTRAINT fk_lr_user FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4''',
    '''CREATE TABLE IF NOT EXISTS approval_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  approver_id INT NOT NULL,
  action VARCHAR(24) NOT NULL,
  comment TEXT,
  created_at DATETIME NOT NULL,
  round INT DEFAULT 1,
  CONSTRAINT fk_al_request FOREIGN KEY(request_id) REFERENCES leave_requests(id),
  CONSTRAINT fk_al_user FOREIGN KEY(approver_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4''',
    '''CREATE TABLE IF NOT EXISTS calendar_days (
  holiday_date VARCHAR(16) PRIMARY KEY,
  day_type VARCHAR(16) NOT NULL,
  name VARCHAR(64) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4''',
    '''CREATE TABLE IF NOT EXISTS leave_adjustments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  user_id INT NOT NULL,
  adjustment_type VARCHAR(16) NOT NULL,
  proposed_time DATETIME NOT NULL,
  reason TEXT,
  material_status VARCHAR(24) NOT NULL DEFAULT 'complete',
  material_note TEXT,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  submitted_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deadline_at DATETIME NULL,
  approver_comment TEXT,
  review_round INT DEFAULT 1,
  CONSTRAINT fk_la_request FOREIGN KEY(request_id) REFERENCES leave_requests(id),
  CONSTRAINT fk_la_user FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4''',
    '''CREATE TABLE IF NOT EXISTS adjustment_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  adjustment_id INT NOT NULL,
  approver_id INT NOT NULL,
  action VARCHAR(24) NOT NULL,
  comment TEXT,
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_adjustment_log FOREIGN KEY(adjustment_id) REFERENCES leave_adjustments(id),
  CONSTRAINT fk_adjustment_user FOREIGN KEY(approver_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4''',
    '''CREATE TABLE IF NOT EXISTS attachments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(128) UNIQUE NOT NULL,
  user_id INT NOT NULL,
  entity_type VARCHAR(24) NOT NULL DEFAULT 'pending',
  entity_id INT NOT NULL DEFAULT 0,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  size INT NOT NULL,
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_att_user FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4''',
    '''CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  category VARCHAR(24) NOT NULL DEFAULT 'leave',
  request_id INT DEFAULT 0,
  is_read TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_ntf_user FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4''',
    '''CREATE TABLE IF NOT EXISTS sessions (
  token VARCHAR(128) PRIMARY KEY,
  user_id INT NOT NULL,
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  CONSTRAINT fk_session_user FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4''',
    '''CREATE TABLE IF NOT EXISTS approval_delegations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  approver_id INT NOT NULL,
  delegate_approver_id INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_del_approver FOREIGN KEY(approver_id) REFERENCES users(id),
  CONSTRAINT fk_del_delegate FOREIGN KEY(delegate_approver_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4''',
]


def init_schema(conn):
    if BACKEND == "mysql":
        for sql in MYSQL_TABLES:
            conn.execute(sql)
        return
    conn.executescript(SQLITE_SCHEMA)
    for sql in (
        "ALTER TABLE users ADD COLUMN hire_date TEXT DEFAULT ''",
        "ALTER TABLE users ADD COLUMN youngest_child_birthdate TEXT DEFAULT ''",
        "ALTER TABLE users ADD COLUMN parent_care_eligible INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN department TEXT DEFAULT '综合管理部'",
        "ALTER TABLE users ADD COLUMN linked_employee_id INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN approval_approver_id INTEGER DEFAULT 0",
        "ALTER TABLE leave_requests ADD COLUMN policy_unit TEXT DEFAULT ''",
        "ALTER TABLE leave_requests ADD COLUMN exception_requested INTEGER DEFAULT 0",
        "ALTER TABLE leave_requests ADD COLUMN related_request_no TEXT DEFAULT ''",
        "ALTER TABLE leave_requests ADD COLUMN modification_count INTEGER DEFAULT 0",
    ):
        try:
            conn.execute(sql)
        except OperationalError:
            pass
