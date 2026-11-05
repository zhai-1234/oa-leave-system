# -*- coding: utf-8 -*-
import json
import os
import importlib
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from fastapi import HTTPException


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        os.environ["LEAVE_DB_PATH"] = str(Path(cls.tmp.name) / "api.db")
        import server
        import fastapi_app
        importlib.reload(server)
        importlib.reload(fastapi_app)
        server.init_db()
        cls.fapp = fastapi_app

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def call(self, method, path, body="", cookie=None):
        data = body.encode("utf-8") if isinstance(body, str) else (body or b"")
        headers = {"Content-Length": str(len(data))}
        if cookie:
            headers["Cookie"] = cookie
        return self.fapp.run_legacy(method, path, headers, data)

    def _login(self, username, password="123456"):
        r = self.call("POST", "/api/login", '{"username":"%s","password":"%s"}' % (username, password))
        self.assertEqual(r.status_code, 200, r.body.decode("utf-8", "ignore"))
        token = r.headers.get("set-cookie", "").split("session=")[1].split(";")[0]
        return token

    def test_unauthorized_401(self):
        self.assertEqual(self.call("GET", "/api/me").status_code, 401)

    def test_login_and_me(self):
        token = self._login("employee")
        me = self.call("GET", "/api/me", cookie="session=" + token)
        self.assertEqual(me.status_code, 200)

    def test_role_403(self):
        token = self._login("employee")
        r = self.call("GET", "/api/admin/requests", cookie="session=" + token)
        self.assertEqual(r.status_code, 403)

    def test_submit_and_approve_flow(self):
        emp = self._login("employee")
        start_d = date.today() + timedelta(days=10)
        while start_d.weekday() >= 5:
            start_d += timedelta(days=1)
        end_d = start_d + timedelta(days=1)
        while end_d.weekday() >= 5:
            end_d += timedelta(days=1)
        start = start_d.isoformat()
        end = end_d.isoformat()
        created = self.call("POST", "/api/requests",
                            '{"leave_type":"事假","start_time":"%s","end_time":"%s","reason":"去银行办事","pending_material":false,"emergency_report":false}' % (start, end),
                            cookie="session=" + emp)
        self.assertEqual(created.status_code, 201, created.body.decode("utf-8", "ignore"))
        request_no = json.loads(created.body.decode("utf-8"))["request_no"]

        app = self._login("approver")
        admin = self.call("GET", "/api/admin/requests", cookie="session=" + app)
        items = json.loads(admin.body.decode("utf-8"))["requests"]
        item = next(x for x in items if x["request_no"] == request_no)
        approved = self.call("POST", "/api/admin/requests/%s/action" % item["id"],
                             '{"action":"approve","comment":"同意"}', cookie="session=" + app)
        self.assertEqual(approved.status_code, 200)

    def test_ai_auth_gate(self):
        class Req:
            class Cookies:
                def get(self, k):
                    return None
            cookies = Cookies()
        with self.assertRaises(HTTPException) as ctx:
            self.fapp._auth_user(Req())
        self.assertEqual(ctx.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main(verbosity=2)
