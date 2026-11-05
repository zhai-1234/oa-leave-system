# 请假系统部署与测试文档

## 1. 技术选型
- 应用层：FastAPI + Uvicorn，业务逻辑在 `server.py`。
- 数据库：默认 SQLite，支持通过环境变量切换到 MySQL 8。
- 前端：Vue 3 + Vue Router，默认入口为 `static/index.html`，组件位于 `static/vue/`。
- AI 能力：DeepSeek 对话 + 通义 Embedding，规则版可离线兜底。

## 2. 本地运行（SQLite）
```powershell
.\run.bat
```
或：
```powershell
.\venv-win\Scripts\python.exe start_fastapi.py
```
访问 `http://127.0.0.1:8000`。演示账号：`employee / 123456`、`approver / 123456`。

## 3. 切换到 MySQL 8
默认不改变现有本地运行方式；需要 MySQL 时再启用。

```powershell
pip install -r requirements-mysql.txt
$env:LEAVE_DB_BACKEND="mysql"
$env:MYSQL_HOST="127.0.0.1"
$env:MYSQL_PORT="3306"
$env:MYSQL_USER="root"
$env:MYSQL_PASSWORD="你的密码"
$env:MYSQL_DATABASE="leave_system"
.\venv-win\Scripts\python.exe start_fastapi.py
```

首次启动会自动建表，并写入演示账号。数据库需要提前创建：
```sql
CREATE DATABASE leave_system DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

迁移现有 SQLite 数据：
```powershell
$env:LEAVE_DB_BACKEND="mysql"
$env:MYSQL_USER="root"
$env:MYSQL_PASSWORD="你的密码"
$env:MYSQL_DATABASE="leave_system"
.\venv-win\Scripts\python.exe scripts\migrate_sqlite_to_mysql.py
```

> 论文选型说明：SQLite 适合单机原型、零运维；MySQL 适合多人并发、服务端部署、权限隔离和事务恢复。本项目通过 `db.py` 屏蔽两种后端差异。

## 4. Ubuntu 24.04 部署
```bash
sudo apt update
sudo apt install -y python3-venv nginx
# 如使用 MySQL：
sudo apt install -y mysql-server
sudo mysql -e "CREATE DATABASE leave_system DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

上传项目到 `/opt/apps/请假系统`，安装依赖：
```bash
cd /opt/apps/请假系统
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### systemd 服务
创建 `/etc/systemd/system/leave-system.service`：
```ini
[Unit]
Description=OA Leave System FastAPI
After=network.target

[Service]
WorkingDirectory=/opt/apps/请假系统
Environment=LEAVE_DB_BACKEND=mysql
Environment=MYSQL_HOST=127.0.0.1
Environment=MYSQL_PORT=3306
Environment=MYSQL_USER=leave_app
Environment=MYSQL_PASSWORD=你的数据库密码
Environment=MYSQL_DATABASE=leave_system
ExecStart=/opt/apps/请假系统/.venv/bin/python start_fastapi.py
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

启动：
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now leave-system
sudo systemctl status leave-system
```

### Nginx 反向代理
创建 `/etc/nginx/sites-available/leave-system`：
```nginx
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```
启用并检查：
```bash
sudo ln -s /etc/nginx/sites-available/leave-system /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo ufw allow 80/tcp
```

## 5. 测试与评估
### 单元测试
```powershell
.\venv-win\Scripts\python.exe -m unittest discover -s tests -p "test_core.py" -v
.\venv-win\Scripts\python.exe -m unittest discover -s tests -p "test_ai_assistant.py" -v
.\venv-win\Scripts\python.exe -m unittest discover -s tests -p "test_api.py" -v
```

### 性能冒烟
```powershell
.\venv-win\Scripts\python.exe scripts\perf_smoke.py
```
输出 `outputs/perf_report.json`，包含数据库查询和 AI 解析平均耗时。

### AI 准确率评估
规则版（不消耗 API）：
```powershell
.\venv-win\Scripts\python.exe scripts\evaluate_ai.py
```
真实 LLM 版：
```powershell
.\venv-win\Scripts\python.exe scripts\evaluate_ai.py --llm
```
输出 `outputs/ai_eval_report.json`，可直接用于答辩数据表格。

## 6. 常见检查
```bash
ss -lntp | grep -E ":80|:8000|:22"
sudo systemctl status leave-system
sudo systemctl status nginx
curl -s -o /dev/null -w "%{http_code}
" http://127.0.0.1/
```
