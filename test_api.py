# -*- coding: utf-8 -*-
"""一键验证：对话(DeepSeek) 与 Embedding(通义) 是否连通。运行：python test_api.py"""
import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ai_assistant as ai

print("配置：", json.dumps(ai.config_public(), ensure_ascii=False))
print()
print("[1] 对话 DeepSeek ...")
ans = ai.llm_chat([{"role": "user", "content": "请只回复四个字：连接正常"}], temperature=0)
print("    结果：", ans if ans else "失败（检查 llm_api_key / llm_base_url / llm_model）")
print()
print("[2] Embedding 通义 text-embedding-v3 ...")
emb = ai.llm_embed(["婚假要提前几天申请，需要什么材料"])
print("    结果：", ("成功，向量维度 %d" % len(emb[0])) if emb else "失败（检查 embedding_api_key / embedding_base_url / embedding_model）")
print()
hits, mode = ai.retrieve("结婚要交什么证明", 3)
print("[3] 检索实际模式：", mode, "| 命中：", [h["title"] for h in hits])
