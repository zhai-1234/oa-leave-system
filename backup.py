"""安全备份 SQLite 数据库，默认保留最近 30 份。"""

import sqlite3
from datetime import datetime
from pathlib import Path

from server import DB_PATH, ROOT


def create_backup(keep=30):
    backup_dir = ROOT / "backups"
    backup_dir.mkdir(exist_ok=True)
    target = backup_dir / f"leave_system_{datetime.now():%Y%m%d_%H%M%S}.db"
    source_conn = sqlite3.connect(DB_PATH)
    target_conn = sqlite3.connect(target)
    try:
        source_conn.backup(target_conn)
    finally:
        target_conn.close()
        source_conn.close()
    backups = sorted(backup_dir.glob("leave_system_*.db"), reverse=True)
    for old in backups[max(1, keep):]:
        old.unlink()
    return target


if __name__ == "__main__":
    print(create_backup())
