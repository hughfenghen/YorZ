# AGENTS.md

- 所有沟通和回复都使用中文：回复内容、执行过程描述
- 需要展示给用户的文字须使用国际化配置：桌面端 @src/gui/src/i18n/ ，移动端 @src/gui-mobile/src/i18n/
- 两个前端各自独立（桌面端 @src/gui 挂在 `/`，移动端 PWA @src/gui-mobile 挂在 `/m/`），
  共享物有两类：设计令牌 @src/styles/theme-tokens.css 与平台无关逻辑层 @src/gui-shared （两端以 `@shared/*` 引入，
  各自 include，彼此之间没有 project reference）；仍然禁止两端互相直引源码。移动端约定见 @src/gui-mobile/README.md
- spec 文档中文件路径字符串前的 `@` 前缀符号表示当前项目的根路径
