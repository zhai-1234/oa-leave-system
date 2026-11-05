import importlib
import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


class PhaseOneFastAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        os.environ["LEAVE_DB_PATH"] = str(Path(cls.temp_dir.name) / "phase1.db")
        import server
        import fastapi_app
        importlib.reload(server)
        importlib.reload(fastapi_app)
        cls.server = server
        cls.client_context = TestClient(fastapi_app.app)
        cls.client = cls.client_context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client_context.__exit__(None, None, None)
        cls.temp_dir.cleanup()

    def login(self, username, password="123456"):
        client = TestClient(self.client.app)
        response = client.post("/api/login", json={"username": username, "password": password})
        self.assertEqual(response.status_code, 200, response.text)
        return client

    def test_01_static_and_docs(self):
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertIn("text/html", self.client.get("/").headers["content-type"])
        self.assertEqual(self.client.get("/api/docs").status_code, 200)

    def test_02_employee_permissions_and_leave_flow(self):
        employee = self.login("employee")
        self.assertEqual(employee.get("/api/me").status_code, 200)
        self.assertEqual(employee.get("/api/admin/requests").status_code, 403)

        created = employee.post("/api/requests", json={
            "leave_type": "年休假",
            "start_time": "2026-09-01",
            "end_time": "2026-09-02",
            "reason": "",
            "pending_material": False,
            "emergency_report": False,
        })
        self.assertEqual(created.status_code, 201, created.text)
        request_no = created.json()["request_no"]

        approver = self.login("approver")
        admin_items = approver.get("/api/admin/requests")
        self.assertEqual(admin_items.status_code, 200, admin_items.text)
        item = next(x for x in admin_items.json()["requests"] if x["request_no"] == request_no)
        self.assertIn("available_balance", item)
        self.assertIn("balance_after_approval", item)
        self.assertTrue(item["balance_sufficient"])

        detail = approver.get(f"/api/admin/requests/{item['id']}")
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertNotIn("balances", detail.json())

        approved = approver.post(f"/api/admin/requests/{item['id']}/action", json={
            "action": "approve", "comment": "同意"
        })
        self.assertEqual(approved.status_code, 200, approved.text)

        notifications = employee.get("/api/notifications")
        self.assertEqual(notifications.status_code, 200, notifications.text)
        self.assertTrue(any(request_no in x["message"] for x in notifications.json()["notifications"]))

        employee_detail = employee.get(f"/api/requests/{item['id']}")
        self.assertEqual(employee_detail.status_code, 200, employee_detail.text)
        self.assertEqual(employee_detail.json()["request"]["status"], "approved")

    def test_03_formal_database_not_used(self):
        self.assertNotEqual(Path(os.environ["LEAVE_DB_PATH"]).resolve(), (Path.cwd() / "leave_system.db").resolve())


if __name__ == "__main__":
    unittest.main(verbosity=2)
