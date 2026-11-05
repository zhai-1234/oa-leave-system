"""请假系统 FastAPI 手动启动入口。"""

import os

import uvicorn


if __name__ == "__main__":
    uvicorn.run(
        "fastapi_app:app",
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8000")),
        reload=os.environ.get("RELOAD", "1") == "1",
        workers=1,
    )

