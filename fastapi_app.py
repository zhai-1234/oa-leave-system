"""FastAPI 入口：第一阶段兼容迁移，保持现有 API 和 SQLite 数据不变。"""

from contextlib import asynccontextmanager
from email.message import Message
from io import BytesIO

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import Response

import server as legacy
import ai_assistant as ai


@asynccontextmanager
async def lifespan(_: FastAPI):
    legacy.init_db()
    yield


app = FastAPI(
    title="OA 请假系统",
    version="2.0.0-phase1",
    docs_url="/api/docs",
    redoc_url=None,
    lifespan=lifespan,
)


def run_legacy(method: str, path: str, request_headers, body: bytes) -> Response:
    """将已验证的业务处理器置于 FastAPI HTTP 层之后。"""
    handler = object.__new__(legacy.Handler)
    handler.path = path
    handler.command = method
    handler.request_version = "HTTP/1.1"
    handler.headers = Message()
    for key, value in request_headers.items():
        handler.headers[key] = value
    handler.rfile = BytesIO(body)
    handler.wfile = BytesIO()

    captured = {"status": 200, "headers": []}
    handler.send_response = lambda code, message=None: captured.__setitem__("status", code)
    handler.send_header = lambda key, value: captured["headers"].append((key, value))
    handler.end_headers = lambda: None
    handler.log_request = lambda *args, **kwargs: None
    handler.log_error = lambda *args, **kwargs: None

    if method == "GET":
        handler.do_GET()
    elif method == "POST":
        handler.do_POST()
    else:
        return Response(content='{"error":"不支持的请求方法"}', status_code=405, media_type="application/json")

    response_headers = {}
    for key, value in captured["headers"]:
        if key.lower() not in {"content-length", "server", "date"}:
            response_headers[key] = value
    return Response(content=handler.wfile.getvalue(), status_code=captured["status"], headers=response_headers)


def _auth_user(request: Request, role=None):
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(status_code=401, detail="请先登录")
    conn = legacy.db()
    try:
        row = conn.execute(
            "SELECT user_id FROM sessions WHERE token=? AND datetime(expires_at)>datetime('now','localtime')",
            (token,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="请先登录")
        user = conn.execute("SELECT * FROM users WHERE id=?", (row["user_id"],)).fetchone()
        if not user:
            raise HTTPException(status_code=401, detail="请先登录")
        user = dict(user)
    finally:
        conn.close()
    if role and user.get("role") != role:
        raise HTTPException(status_code=403, detail="无权访问审批功能")
    return user


async def _ai_json(request: Request):
    try:
        return await request.json()
    except Exception:
        return {}


@app.get("/api/ai/status")
async def ai_status(request: Request):
    _auth_user(request)
    return ai.status()


@app.post("/api/ai/qa")
async def ai_qa(request: Request):
    user = _auth_user(request)
    data = await _ai_json(request)
    return ai.qa(data.get("question", ""), user)


@app.post("/api/ai/review")
async def ai_review(request: Request):
    _auth_user(request)
    data = await _ai_json(request)
    return ai.review(data)


@app.post("/api/ai/parse")
async def ai_parse(request: Request):
    user = _auth_user(request)
    data = await _ai_json(request)
    return ai.parse_leave(data.get("text", ""), user)


@app.get("/api/ai/config")
async def ai_config(request: Request):
    _auth_user(request)
    return ai.config_public()


@app.post("/api/ai/config")
async def ai_config_save(request: Request):
    _auth_user(request)
    data = await _ai_json(request)
    return ai.config_public(ai.save_config(data))


@app.post("/api/ai/review-request/{request_id}")
async def ai_review_request(request: Request, request_id: int):
    user = _auth_user(request)
    return ai.review_request(request_id, user)


@app.post("/api/ai/review-batch")
async def ai_review_batch(request: Request):
    user = _auth_user(request)
    return ai.review_batch(user)


@app.post("/api/ai/test-llm")
async def ai_test_llm(request: Request):
    _auth_user(request)
    return ai.test_llm()


@app.api_route("/{path:path}", methods=["GET", "POST"], include_in_schema=False)
async def compatibility_route(request: Request, path: str):
    body = await request.body()
    raw_path = request.url.path
    if request.url.query:
        raw_path += "?" + request.url.query
    return run_legacy(request.method, raw_path, request.headers, body)
