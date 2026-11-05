# 前端 Vue 升级说明

## 1. 升级结论

前端由「原生 JavaScript 单页应用」升级为「Vue 3 + Vue Router 组件化单页应用」，
后端接口、数据库结构、权限模型和业务流程均未改动，属于纯前端重构。

- 框架：Vue 3.5.13（全局构建，含模板编译器）
- 路由：Vue Router 4.5.0（Hash 模式）
- 运行库：本地内置，位于 `static/vendor/`，不依赖外部 CDN，可离线与内网运行
- 构建方式：无打包步骤，浏览器直接加载 ES5/ES2018 兼容的 IIFE 模块，部署方式与原来完全一致
- 样式：复用原有 `style.css` 与 `saas.css`，新增少量 `vue.css` 补充样式

## 2. 目录结构

```
static/
  index.html                  Vue 版入口（当前默认）
  index.legacy.html           旧版入口（回退用）
  app.js                      旧版脚本（回退用，index.legacy.html 引用）
  app.legacy.js               旧版脚本快照
  vue.css                     Vue 版补充样式
  style.css / saas.css        原有样式，未改动
  vendor/
    vue.global.prod.js        Vue 3.5.13
    vue-router.global.prod.js Vue Router 4.5.0
  vue/
    core.js                   响应式状态、API 封装、公共工具、登录记忆、未读轮询
    components.js             余额判断条、附件图墙、密码输入框、申请卡片、审批卡片、审批轨迹
    dialogs.js                确认、打回、修改申请、销假续假、修改密码 弹窗
    shell.js                  应用外壳：侧边栏、顶栏、AI 悬浮球与弹窗容器
    pages-login.js            登录页（账号记忆、密码显示、注册）
    pages-employee.js         员工端：工作台、发起请假、请假记录、假期余额、制度流程、消息通知、申请详情
    pages-approver.js         审批端：待办审批、审批记录、返岗续假、假期管理、审批代理、审批详情
    detail-only.js            详情独立页（新标签打开，仅展示详情）
    ai.js                     AI 助手：制度问答、智能填单、审批预审、批量预审
    app.js                    路由表、登录守卫、组件注册、启动挂载
```

## 3. 路由表

| 路径 | 页面 | 角色 |
| --- | --- | --- |
| `#/login` | 登录 / 注册 | 公开 |
| `#/home` | 员工工作台 | 员工 |
| `#/apply` | 发起请假 | 员工 |
| `#/profile` | 我的假期余额 | 员工 |
| `#/records` | 我的请假记录 | 员工 |
| `#/guide` | 制度与流程 | 员工 |
| `#/notifications` | 消息通知 | 全部 |
| `#/requests/:id` | 我的申请详情 | 员工 |
| `#/admin` | 待办审批 | 审批员 |
| `#/history` | 审批记录（全量） | 审批员 |
| `#/admin/requests/:id` | 审批详情 | 审批员 |
| `#/history/requests/:id` | 审批详情（全量视图） | 审批员 |
| `#/adjustments` | 返岗与续假审批 | 审批员 |
| `#/hr` | HR 假期管理 | 审批员 |
| `#/delegation` | 审批代理 | 审批员 |
| `#/detail?id=N` | 详情独立页 | 全部 |

兼容旧深链：访问 `/index.html?request=N` 会自动跳转到详情独立页。

## 4. 行为保持

- 打开系统默认进入登录页；仅当携带 `?request=` 深链时直接进入详情。
- 登录守卫在进入受保护页面前自动恢复会话，失败则回到登录页。
- 未读消息每 30 秒轮询一次，进入详情时按申请单标记已读。
- 审批员不可审批自己的申请：后端仍返回 403，前端隐藏操作按钮。
- 审批代理需代理人确认后生效，待办按审批范围过滤，历史记录对所有管理账号开放。
- AI 助手支持悬浮球拖动、历史记录（制度问答与智能填单独立记忆）、关键词高亮、Markdown 渲染、一键发起请假、批量预审、详情新标签打开。

## 5. 验证方式

```powershell
# 1) 语法检查
Get-ChildItem static\vue -Filter *.js | ForEach-Object { node --check $_.FullName }

# 2) 启动服务
.\run.bat

# 3) 在另一个终端执行浏览器冒烟测试
python scripts\verify_vue_frontend.py
```

冒烟脚本会在真实 Chrome/Edge 中登录员工和审批员账号，遍历全部核心路由，并检查：

- Vue 模板编译错误、页面运行时异常和非预期 HTTP 错误；
- 桌面端员工工作台、审批工作台与 AI 助手面板；
- 390px 窄屏布局及横向溢出；
- 截图输出到 `outputs/vue-employee-home.png`、`outputs/vue-approver-admin.png`
  和 `outputs/vue-employee-mobile.png`。

## 6. 回退方案

旧前端完整保留，可直接切回：

- 访问 `http://127.0.0.1:8000/index.legacy.html` 使用旧版界面；
- 或将 `static/index.legacy.html` 覆盖 `static/index.html` 恢复默认旧版。

## 7. 论文可引用的技术要点

- 前端采用 Vue 3 组件化架构，按页面与共享组件拆分，状态通过 `reactive` 集中管理。
- 使用 Vue Router 的 Hash 模式与全局前置守卫实现登录态校验和角色路由。
- AI 助手作为独立组件复用同一套 API 层，避免与业务页面耦合。
- 运行库本地内置，无打包链路即可部署，适配内网与离线演示环境。
- 升级未改动后端接口与数据库，验证了前后端分离接口契约的稳定性。
