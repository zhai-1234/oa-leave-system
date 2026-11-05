# OA 请假系统 · AI 助手演示版

在原「OA 请假系统」副本上新增的 AI 助手 MVP，不动原项目。

## 功能与接口（均已加登录鉴权）
- 制度智能问答：`POST /api/ai/qa`（向量检索 + 带出处回答）
- 审批合规预审：`POST /api/ai/review`（提前量/余额/材料/事由规则 + LLM 摘要）
- 智能填单：`POST /api/ai/parse`（中文日期与假种解析）
- 状态：`GET /api/ai/status`（LLM / 向量模式）
- 配置：`GET|POST /api/ai/config`（读写 ai_config.json）
- 连接测试：`POST /api/ai/test-llm`
- 鉴权：所有 /api/ai/* 接口要求登录（session Cookie），未登录返回 401。

## 向量 RAG
- 默认：字符 n-gram TF-IDF + 余弦相似度（离线可用，无需外部依赖）。
- 可选：配置 embedding 接口后切换为稠密向量（见下方 USE_EMBEDDING_API）。

## 大模型接入（可选）
不配置也能跑（规则引擎兜底）。配置方式二选一：

1) 写 ai_config.json：
```json
{
  "llm_api_key": "你的Key",
  "llm_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "llm_model": "qwen-plus",
  "embedding_model": "text-embedding-v3",
  "use_embedding_api": true
}
```

2) 或设置环境变量：LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / EMBEDDING_MODEL / USE_EMBEDDING_API。

常见 Base URL：
- 通义千问：https://dashscope.aliyuncs.com/compatible-mode/v1
- DeepSeek：https://api.deepseek.com/v1

## 运行
1. 双击 run.bat（复用原项目 .venv-win 环境）。
2. 打开 http://127.0.0.1:8000 登录后点左侧「AI 助手」。

## 演示数据与一键发起
- 重置演示数据：在副本目录运行 `python seed_demo.py`（保留账号与余额，重建 13 条多状态假条）。
- 智能填单解析后可点「一键发起请假」，复用原系统校验真实提交。

## Embedding 向量检索（可选）
DeepSeek 不支持 Embedding，要用向量检索需单独配一个 Embedding 供应商（对话仍用 DeepSeek）。在 ai_config.json 增加：
```json
{
  "use_embedding_api": true,
  "embedding_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "embedding_api_key": "你的通义Key",
  "embedding_model": "text-embedding-v3"
}
```
不配置则自动回退到字符 n-gram 余弦向量（离线可用）。
