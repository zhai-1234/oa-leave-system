import importlib
import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


class PhaseTwoSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        os.environ["LEAVE_DB_PATH"] = str(Path(cls.temp_dir.name) / "phase2.db")
        import server
        import fastapi_app
        import backup
        importlib.reload(server)
        importlib.reload(fastapi_app)
        importlib.reload(backup)
        cls.server, cls.backup = server, backup
        cls.context = TestClient(fastapi_app.app)
        cls.client = cls.context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.context.__exit__(None, None, None)
        cls.temp_dir.cleanup()

    def test_01_legacy_password_upgrades_to_argon2(self):
        conn = self.server.db()
        conn.execute("UPDATE users SET password_hash=? WHERE username='employee'",
                     (self.server.legacy_password_hash("123456"),))
        conn.commit(); conn.close()
        response = self.client.post("/api/login", json={"username":"employee","password":"123456"})
        self.assertEqual(response.status_code, 200, response.text)
        conn = self.server.db()
        stored = conn.execute("SELECT password_hash FROM users WHERE username='employee'").fetchone()[0]
        conn.close()
        self.assertTrue(stored.startswith("$argon2"))

    def test_02_session_is_database_backed_and_logout_revokes_it(self):
        logged_in = self.client.post("/api/login", json={"username":"approver","password":"123456"})
        self.assertEqual(logged_in.status_code, 200)
        self.assertEqual(self.client.get("/api/me").status_code, 200)
        conn = self.server.db()
        self.assertGreater(conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 0)
        conn.close()
        self.client.post("/api/logout")
        self.assertEqual(self.client.get("/api/me").status_code, 401)

    def test_03_sqlite_online_backup(self):
        self.backup.ROOT = Path(self.temp_dir.name)
        self.backup.DB_PATH = Path(os.environ["LEAVE_DB_PATH"])
        target = self.backup.create_backup()
        self.assertTrue(target.exists())
        self.assertGreater(target.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
