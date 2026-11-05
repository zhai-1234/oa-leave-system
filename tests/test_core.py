# -*- coding: utf-8 -*-
import os
import importlib
import tempfile
import unittest
from pathlib import Path


class CoreLogicTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        os.environ["LEAVE_DB_PATH"] = str(Path(cls.tmp.name) / "core.db")
        import server
        importlib.reload(server)
        server.init_db()
        cls.server = server
        cls.conn = server.db()

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()
        cls.tmp.cleanup()

    def test_annual_leave_days(self):
        s = self.server
        self.assertEqual(s.annual_leave_days(0), 0)
        self.assertEqual(s.annual_leave_days(5), 5)
        self.assertEqual(s.annual_leave_days(10), 10)
        self.assertEqual(s.annual_leave_days(20), 15)

    def test_medical_period_months(self):
        s = self.server
        self.assertEqual(s.medical_period_months(5, 3), 3)
        self.assertEqual(s.medical_period_months(12, 3), 6)
        self.assertEqual(s.medical_period_months(25, 3), 12)
        self.assertEqual(s.medical_period_months(25, 12), 24)

    def test_leave_days_natural(self):
        self.assertEqual(self.server.leave_days(self.conn, "2026-09-14", "2026-09-16", "自然日"), 3)

    def test_leave_days_workdays(self):
        # 周五(09-11)到周一(09-14) 跨周末 = 2 个工作日
        self.assertEqual(self.server.leave_days(self.conn, "2026-09-11", "2026-09-14", "工作日"), 2)

    def test_password_hash_and_verify(self):
        s = self.server
        h = s.password_hash("123456")
        self.assertTrue(str(h).startswith("$argon2"))
        self.assertTrue(s.verify_password(h, "123456"))
        self.assertFalse(s.verify_password(h, "wrong"))
        legacy = s.legacy_password_hash("123456")
        self.assertTrue(s.verify_password(legacy, "123456"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
