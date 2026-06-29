# TODO

- [ ] Skill 优化
  - [x] 流程节点模块化
  - [ ] 新建spec 时关联相似需求、或相关代码
  - [ ] 方案的影响范围、变更范围
  - [ ] Skill 的可测试性、效果评估
  - [x] 待确认问题列表没有按规范格式生成，AI输出未提供方案候选项和建议方案
  - [ ] 用户添加批注内容缺少二级标题
- [ ] review 模式
  - [x] git 变更文件
  - [ ] 图形化差异变更表达
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
  - [x] agent ：opencode/claude
  - [x] spec 目录
- [ ] UI / 功能 优化
  - [ ] 项目管理、Worktree 管理
    - [ ] 添加 drafts 到 ignore
  - [ ] 支持导入或粘贴剪贴板中的图片
  - [ ] spec 列表，按天分组，降序
    - [ ] 按分类、模块过滤，名称、内容模糊匹配
    - [ ] 列表按时间降序，精确到秒
  - [ ] @ mention spec 或文件、模块
  - [ ] 界面结构、布局、元素的美化
  - [ ] 快捷键系统
- [ ] 外部能力集成
  - [ ] 代码知识库、
    - [ ] 项目模块分析
    - [ ] 模块依赖关系
    - [ ] 模块与源码文件关系
  - [ ] 核心变更逻辑流程图、时序图、数据流图等等

- UI 美化
  - [ ] 优化 spec 文档渲染结果，内容结果优化，图形优先
  - [ ] 优化 Agent 输出效果，终端渲染库

## Bug

- [ ] 提交git关联文件时，不会 stage 关联文件、不会提交 spec md 文件本身
  - 最后一次提交动作会从touch files文件中移除掉spec文件路径
  - 之后再更新 spec md last_action: 提交 git
- [ ] 图片在 GUI 中无法显示`![image-d175.png](attachments/image-d175.png)`

- [ ] 持久化 Agent任务的执行信息，与 spec 文档关联
- [ ] task 阶段长任务也积极执行，而不是暂停询问
- [ ] 生成待确认问题清单的UI应该忽略已确认决策内容

```md
5. 待确认问题
   worktree 项目 Home 页 worktree-bar 中「主项目：<mainPath>」这条信息，去掉 worktree 技术词汇后是否继续展示？
   完全移除，仅留「合入主项目」按钮 + 状态提示
   改为「主项目：<mainBasename>」（只展示路径末段，保留辨识度，不暴露绝对路径） (推荐)
   保留当前完整绝对路径
   5.1 已确认决策快照
   worktree 目录：<mainPath>/../<mainBasename>.wt/<branch>。
   分支命名：wt/<spec-summary-name>，重名追加 -2/-3。
   主项目合并方式：git merge --no-ff <branch>。
   冲突相关 spec 定位：仅按 git log 文件历史（30 天窗口），不依赖 touched-files.json。
   主项目自动更新：等同 merge 动作本身，不额外 git pull。
   commit message：默认 feat(<branch>): merge from worktree，弹窗内可编辑。
   侧栏视觉：扁平 + worktree 项目名后追加 ⎇ main badge。
   冲突解决 spec：落在主项目 .yorz/specs/，type=fix，自动启动 Agent。
```
