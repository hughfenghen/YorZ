# TODO

- [ ] Skill 优化
  - [ ] 不同的流程（spec review 图形化生成）考虑是否需要拆分skill
  - [ ] 方案的影响范围、变更范围；spec review 都可能用到（差异是预估和实际影响）
  - [ ] Skill 的可测试性、效果评估
  - [ ] spec 格式检测机制：图形语法，待确认问题格式（是否能解析通过）
  - [ ] 简化版工作流（skill），处理简单小问题
- [ ] review 模式
  - [ ] 图形化差异变更表达
- [ ] 不建立 spec 的沟通
  - [ ] 小问题咨询/执行
- [ ] 临时问题咨询 Agent？
- [ ] 图形化、可视化
  - [ ] spec 文档需要更丰富的可视化表达
  - [ ] 优先展示图形、默认折叠文字
- [ ] UI / 功能 优化
  - [ ] 按模块或文件依赖图，标记影响范围； review / spec
  - [ ] 管理项目开发服务
    - [ ] 分享服务日志给 Agent
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

- Agent 任务内的卡片，点击 header 展开/折叠
- review 简化 git 提交
- @ 关联模块、文件

## Bug

- [ ] 图形化语法错误
- [ ] 图形化区域显示纯代码文本，刷新后正常，可能是解析时机存在 bug

当前项目已经实现使用 mermaid skill 来指导 Agent 在编写 spec 时输出图形（mermaid 语法代码块），优化 spec 的可读性。
mermaid 支持非常多种类的图形，有一些图形在编程领域用不上，我希望移除它们的 skill，减少体积，或者不要编入索引，避免被Agent读取；

当前能绘制一些基础的流程图、时序图，我已经发现的一需要优化的场景：

- 类型定义使用类图，展现类型属性与继承、组合关系；而不是使用 ts 代码
- 表达层级结构信息、或逻辑，使用 treemap；而不是 ASCII 字符树
- 核心代码逻辑使用流程图；而不是 md 列表 + 文字进行描述
- 关键状态关系、变更，使用状态图

同时还需要你提供更多的建议：在编写 spec 时，什么场景应该使用哪些图形，请优化 @src/skill/yorz-spec/mermaid.md；

请了解 yorz skill spec 驱动开发工作流， 分析是否可以优化；

- @src/skill/yorz-spec/SKILL.md @src/skill/yorz-spec/plan.md
- @src/skill/yorz-spec/conventions.md
- @src/skill/yorz-spec/execute.md
- @src/skill/yorz-spec/new-spec.md

1. 我期望简化 skill、提升 Agent 推荐流程的速度、提升 Agent 实施质量；
2. 是否可以简化 skill 对文档格式的描述与限制，使用简单正面示例 + yorz  
   lint 避免 Agent 跑偏？ @src/lint/rules/
3. 期望移除 rules 中对必填章节的校验，lint  
   目的是确保关键格式符合期望，避免后续流程解析失败；如待确认问题解析成  
   UI、mermaid 图形渲染
