# gui-mobile

YorZ 的移动端前端，一个挂在 `/m/` 下的 PWA。与 `src/gui`（桌面端）是**两个独立应用**，
共用同一套技术栈与设计令牌。

## 技术栈

与桌面端一致，便于两边互相搬运代码与经验：

| 关注点 | 选型                                    |
| ------ | --------------------------------------- |
| 框架   | Solid + @solidjs/router                 |
| 构建   | Vite（`vite.gui-mobile.config.ts`）     |
| 样式   | Tailwind + shadcn-solid 约定 + Kobalte  |
| 国际化 | i18next（navigator 探测，不落缓存）     |
| 图标   | lucide-solid                            |
| PWA    | vite-plugin-pwa（generateSW / Workbox） |

## 命令

```bash
pnpm dev:gui-mobile      # 开发服务器，:5174，/api 代理到 :7424
pnpm build:gui-mobile    # 产出 dist/gui-mobile
pnpm gen:mobile-icons    # 重新生成 public/icons/*.png（改主色时才需要）
```

真机调试：先 `pnpm dev:cli` 起后端，再 `pnpm dev:gui-mobile`，手机访问
`http://<你的局域网 IP>:5174/m/`。注意 Service Worker 只在 localhost 或 HTTPS 下注册，
局域网 IP + HTTP 能看界面但装不了应用；要验证安装流程就跑 `pnpm build && node dist/cli/index.js serve`
再走 localhost（或用隧道给一个 HTTPS 域名）。

## 目录

```
index.html            入口；含主题引导脚本与 iOS 私有 meta
public/icons/         PWA 图标（由 scripts/gen-mobile-icons.mjs 生成，需提交）
src/app.css           移动端基础层：安全区、触摸手感、视口高度
src/main.tsx          路由注册；base="/m"
src/AppShell.tsx      外壳：状态横幅 / 内容 / 底部导航
src/components/       Page、TopBar、TabBar、StatusBanner + ui/（shadcn-solid）
src/pages/            页面（当前均为占位）
src/lib/              theme / pwa / network / cn
src/i18n/             文案，zh-CN 为准，en 由类型约束保持同构
```

## 几条约定

**`/m/` 前缀在四处出现，改动必须同步**：`vite.gui-mobile.config.ts` 的 `base`、
manifest 的 `start_url`/`scope`、`src/main.tsx` 里 Router 的 `base`、
以及 `src/service/static.ts` 的 `MOBILE_PREFIX`。Service Worker 的控制范围由它
所在目录决定，前缀对不上就要么接管不到页面，要么越界接管桌面端。

**不要从这里 import `src/gui` 的源码**。两个前端是各自独立的 TS composite 工程，
跨工程直引源码会让文件同时归属两个 project、破坏增量构建。需要共享时抽成独立模块，
两边各自 include——样式已按这个办法共享，见 `src/styles/theme-tokens.css`。

**配色改一处生效两端**：颜色/圆角/字体全部来自 `src/styles/theme-tokens.css`，
这里只写布局与移动端特有的基础样式。

**展示给用户的文字一律走 `src/i18n/`**，不要在组件里硬编码中文。

**滚动发生在 `.scroll-y` 容器里，不是 body**：body 被锁成 `overflow: hidden`，
否则 iOS 会把整页橡皮筋叠加在内部滚动上。新增可滚动区域时套 `.scroll-y`，
并确保它到 `#app` 的每一层 flex 子项都带 `min-h-0`。
