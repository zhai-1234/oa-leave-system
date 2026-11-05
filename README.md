# OA 请假系统（FastAPI 第一阶段）

后端 HTTP 服务使用 FastAPI + Uvicorn，前端使用 Vue 3 + Vue Router 组件化单页应用，
保留 SQLite 和本地附件存储。密码使用 Argon2，登录会话持久化到 SQLite。

## 启动

```bash
./.venv/bin/python start_fastapi.py
```

浏览器访问 `http://127.0.0.1:8000`。局域网其他设备使用 `http://本机局域网IP:8000`。

演示账号：

- 员工：`employee` / `123456`
- 审批员：`approver` / `123456`

数据库文件 `leave_system.db` 会在首次启动时自动创建并写入演示数据。

## 初次安装

```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

## 回归测试

```bash
./.venv/bin/pip install -r requirements-dev.txt
./.venv/bin/python -m unittest tests.test_api -v
node --check static/vue/app.js
./.venv/bin/python scripts/verify_vue_frontend.py
```

`server.py` 保留为业务兼容层和紧急回退入口；正常使用请通过 `start_fastapi.py` 启动。
前端入口为 `static/index.html`，Vue 组件位于 `static/vue/`，详细结构见 `docs/frontend-vue.md`。

## 备份

```bash
./.venv/bin/python backup.py
```

备份保存在 `backups/`，默认自动保留最近 30 份。旧版密码摘要会在用户下一次成功登录时自动升级为 Argon2。

> 当前仍是局域网原型，不应直接用于公网生产环境。
