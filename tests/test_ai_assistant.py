# -*- coding: utf-8 -*-
import os
import importlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class AIAssistantTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        os.environ["LEAVE_DB_PATH"] = str(Path(cls.tmp.name) / "ai.db")
        import server
        import ai_assistant
        importlib.reload(server)
        importlib.reload(ai_assistant)
        server.init_db()
        cls.server = server
        cls.ai = ai_assistant

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_rule_extract_type_and_reason(self):
        r = self.ai._rule_extract("明天请事假去银行办事")
        self.assertEqual(r["lt"], "事假")
        self.assertEqual(r["reason"], "去银行办事")
        self.assertFalse(r["emergency_report"])
        self.assertFalse(r["pending_material"])

    def test_rule_extract_preserves_unreasonable_reason(self):
        r = self.ai._rule_extract("明天请事假，不想上班")
        self.assertEqual(r["reason"], "不想上班")
        r2 = self.ai._rule_extract("明天请事假，就是不想")
        self.assertEqual(r2["reason"], "就是不想")

    def test_parse_leave_reason_validity(self):
        with patch.object(self.ai, "_llm_extract", return_value=None), patch.object(self.ai, "_llm_enabled", return_value=False):
            bad = self.ai.parse_leave("明天请事假，不想上班")
            self.assertEqual(bad["reason_valid"], "不合理")
            self.assertLessEqual(bad["confidence"], 0.35)
            good = self.ai.parse_leave("明天请事假去银行办事")
            self.assertEqual(good["reason_valid"], "合理")
            self.assertGreater(good["confidence"], 0.5)
    def test_rule_extract_material_flag(self):
        r = self.ai._rule_extract("明天请事假，证明材料还没审核通过")
        self.assertEqual(r["lt"], "事假")
        self.assertTrue(r["pending_material"])
        self.assertIn("审核", r["reason"])

    def test_parse_vague_time_range_recommends(self):
        with patch.object(self.ai, "_llm_extract", return_value=None), patch.object(self.ai, "_llm_enabled", return_value=False):
            r = self.ai.parse_leave("帮我请一个下周一到周五的假", user={"id": 1, "role": "employee"})
            self.assertIsNone(r["leave_type"])
            self.assertEqual(r["reason"], "")
            self.assertLessEqual(r["confidence"], 0.45)
            self.assertFalse(r["complete"])
            self.assertIsNotNone(r["start_date"])
            self.assertIsNotNone(r["end_date"])
            self.assertTrue(r["options"])
            self.assertEqual(r["options"][0]["leave_type"], "年休假")

    def test_parse_vague_no_info_asks(self):
        with patch.object(self.ai, "_llm_extract", return_value=None), patch.object(self.ai, "_llm_enabled", return_value=False):
            r = self.ai.parse_leave("帮我请个假", user={"id": 1, "role": "employee"})
            self.assertIsNone(r["leave_type"])
            self.assertEqual(r["reason"], "")
            self.assertLessEqual(r["confidence"], 0.45)
            self.assertFalse(r["complete"])
            self.assertTrue(r["follow_up"])
    def test_parse_symptom_synonym(self):
        with patch.object(self.ai, "_llm_extract", return_value=None), patch.object(self.ai, "_llm_enabled", return_value=False):
            r = self.ai.parse_leave("明天身体不舒服", user={"id": 1, "role": "employee", "gender": "男"})
            self.assertEqual(r["leave_type"], "一次性短期病假")
            self.assertEqual(r["reason"], "身体不舒服")
            self.assertTrue(r["complete"])
    def test_parse_rule_mode_dates(self):
        with patch.object(self.ai, "_llm_extract", return_value=None):
            r = self.ai.parse_leave("下周三到周五休年假", user={"id": 1, "role": "employee"})
            self.assertEqual(r["leave_type"], "年休假")
            self.assertTrue(r["complete"])
            self.assertEqual(r["days"], 3)
            self.assertFalse(r["reason_required"])

    def test_retrieve_ngram_fallback(self):
        with patch.object(self.ai, "llm_embed", return_value=None):
            hits, mode = self.ai.retrieve("婚假要提前几天申请，需要什么材料")
            self.assertEqual(mode, "ngram-cosine")
            self.assertIn("婚假", [h["title"] for h in hits])

    def test_review_compliance(self):
        with patch.object(self.ai, "llm_chat", return_value=None):
            r = self.ai.review({"leave_type": "婚假", "advance_days": 2, "material_status": "pending",
                                "material_note": "", "days": 3, "available_balance": 3, "reason": ""})
            self.assertEqual(r["verdict"], "不通过")
            self.assertTrue(any("提前" in x for x in r["risk_items"]))
            self.assertTrue(any(x["code"] == "ADVANCE_SHORT" for x in r.get("risk_details", [])))

    def test_qa_personal_balance(self):
        with patch.object(self.ai, "llm_chat", return_value=None):
            r = self.ai.qa("我的年假还有多少", {"id": 1, "role": "employee"})
            self.assertEqual(r["kind"], "personal")
            self.assertIn("年休假", r["answer"])

    def test_review_batch_approver(self):
        with patch.object(self.ai, "llm_chat", return_value=None), patch.object(self.ai, "_llm_enabled", return_value=False):
            r = self.ai.review_batch({"role": "approver", "id": 2})
            self.assertIn("count", r)
            self.assertIsInstance(r.get("items"), list)
            self.assertTrue(r.get("summary"))
    def test_qa_policy(self):
        with patch.object(self.ai, "llm_chat", return_value=None):
            r = self.ai.qa("婚假要提前几天申请，需要什么材料", {"id": 1, "role": "employee"})
            self.assertNotEqual(r.get("kind"), "personal")
            self.assertTrue(r.get("sources"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
