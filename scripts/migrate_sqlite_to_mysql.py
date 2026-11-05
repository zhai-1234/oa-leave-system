# -*- coding: utf-8 -*-
"""SQLite 数据迁移到 MySQL。

使用前：
1. pip install -r requirements-mysql.txt
2. 配置 MYSQL_HOST/MYSQL_PORT/MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE
3. 默认会清空目标库中的同名表后导入，适合首次迁移。
"""
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["LEAVE_DB_BACKEND"] = "mysql"

import db

TABLES = [
    "users",
    "leave_requests",
    "leave_balances",
    "approval_logs",
    "calendar_days",
    "leave_adjustments",
    "adjustment_logs",
    "attachments",
    "notifications",
    "sessions",
]


def main():
    pymysql = db._mysql_module()
    if pymysql is None:
        print("缺少 pymysql，请先执行：pip install -r requirements-mysql.txt")
        sys.exit(2)

    cfg = db._mysql_config()
    target = pymysql.connect(
        host=cfg["host"], port=cfg["port"], user=cfg["user"], password=cfg["password"],
        database=cfg["database"], charset=cfg["charset"], cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )
    source = sqlite3.connect(str(db.DB_PATH))
    source.row_factory = sqlite3.Row

    try:
        db.init_schema(target)
        with target.cursor() as cur:
            cur.execute("SET FOREIGN_KEY_CHECKS=0")
            for table in reversed(TABLES):
                cur.execute(f"TRUNCATE TABLE `{table}`")
            cur.execute("SET FOREIGN_KEY_CHECKS=1")
        target.commit()

        for table in TABLES:
            cur = source.execute(f"SELECT * FROM {table}")
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()
            if not rows:
                print(f"{table:18s} 0 rows")
                continue
            placeholders = ",".join(["%s"] * len(cols))
            col_sql = ",".join(f"`{c}`" for c in cols)
            sql = f"INSERT INTO `{table}` ({col_sql}) VALUES ({placeholders})"
            with target.cursor() as dst:
                dst.executemany(sql, [tuple(r[c] for c in cols) for r in rows])
            print(f"{table:18s} {len(rows)} rows")
        target.commit()
        print("迁移完成")
    finally:
        source.close()
        target.close()


if __name__ == "__main__":
    main()
