# yorz

产品设计文档 @docs/Prod-Design.md
技术架构设计文档 @docs/Architecture.md

## 多项目托管（自 0.1.0 起）

YorZ Service 现在可以同时托管多个本地项目。

- **全局配置文件**：`${YORZ_HOME ?? ${XDG_CONFIG_HOME:-~/.config}/yorz}/projects.json`，按需自动创建；保存已托管项目的 `{ id, path, addedAt, lastActivityAt }`。
- **CLI**：`yorz serve` 不再绑定单一项目根，可在任意目录运行。
  - 若 `process.cwd()` 包含 `.yorz/` 子目录且未在全局列表中，会被静默注册。
  - 使用 `--no-register-cwd` 禁用上述自动注册。
- **GUI 路由**：所有路径加上 `/<projectId>` 前缀，例如 `/<projectId>/`、`/<projectId>/specs/<specId>`。访问 `/` 时会重定向到最近活跃的项目，列表为空则展示欢迎页。
- **左侧项目面板**：可折叠（状态写入 `localStorage['yorz.projectsSidebar.collapsed']`），点击「＋ 添加项目」打开浏览器目录选择，并要求用户确认绝对路径；hover 列表项可点 ✕ 移除（仅清理全局配置，不删除磁盘 `.yorz/`）。
- **API 路径变更**：原 `/api/specs/...`、`/api/spec-drafts/...`、`/api/runs/...`、`/api/events/...` 全部迁移到 `/api/projects/:projectId/...` 前缀；新增全局根级 `GET/POST /api/projects` 与 `DELETE /api/projects/:id`。

### 破坏性变更

- `serve --cwd` 不再代表“当前唯一项目根”，仅作为默认自动注册目录。
- 旧 URL（无 `:projectId` 前缀）不再兼容，未命中前缀化路由的请求会落到欢迎页。
- 旧 `GET /api/projects/current` 已移除；前端通过路由参数获取当前 `projectId`。

## TODO

- [ ] Skill 优化
  - [x] 流程节点模块化
  - [ ] 新建spec 时关联相似需求、或相关代码
  - [ ] 图形化表达优先
  - [ ] 方案的影响范围、变更范围
  - [ ] Skill 的可测试性、效果评估
  - [x] 待确认问题列表没有按规范格式生成，AI输出未提供方案候选项和建议方案
  - [ ] 用户添加批注内容缺少二级标题
- [ ] review 模式
  - [x] git 变更文件
  - [ ] 图形化差异变更表达
  - [ ] specs/260620.feat.pending-confirm-ui-polish/review 未能识别到变更文件
- [ ] 不建立 spec 的沟通
  - [x] spec 追加 bug
  - [ ] 小问题咨询/执行
  - [x] 内容解释
- [ ] 快捷指令
  - [x] 提交git
  - [x] 内容解释
- [ ] 图形化、可视化
  - [ ] spec 文档需要更丰富的可视化表达
  - [ ] 优先展示图形、默认折叠文字
- [ ] 项目配置
  - [ ] agent ：opencode/claude
  - [ ] spec 目录
- [ ] UI / 功能 优化
  - [ ] 项目管理、Worktree 管理
    - [ ] 添加 drafts 到 ignore
  - [ ] 支持导入或粘贴剪贴板中的图片
  - [ ] spec 列表，按天分组，降序
    - [ ] 按分类、模块过滤，名称、内容模糊匹配
    - [ ] 列表按时间降序，精确到秒
  - [ ] @ mention spec 或文件、模块
  - [ ] 界面结构、布局、元素的美化
- [ ] 外部能力集成
  - [ ] 代码知识库、
    - [ ] 项目模块分析
    - [ ] 模块依赖关系
    - [ ] 模块与源码文件关系
  - [ ] 核心变更逻辑流程图、时序图、数据流图等等
