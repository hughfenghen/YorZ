/**
 * 移动端文案。与桌面端 src/gui/src/i18n 各自独立：移动端的措辞更短、
 * 信息密度更低，直接复用桌面端的键会逼着桌面端为移动端妥协。
 * 后续若出现大量真正共用的术语，再抽公共命名空间。
 */
export const zhCN = {
  app: {
    name: 'YorZ',
    tagline: '移动端',
  },
  nav: {
    home: '首页',
    specs: 'Spec',
    settings: '设置',
  },
  home: {
    title: '首页',
    scaffoldTitle: '移动端骨架已就绪',
    scaffoldBody: '技术栈与桌面端一致：Solid + Vite + Tailwind + Kobalte + i18next，已接入 PWA。',
    scaffoldHint: '业务功能尚未接入，此处为占位页面。',
  },
  specs: {
    title: 'Spec',
    empty: '业务功能尚未接入',
  },
  settings: {
    title: '设置',
    appearance: '外观',
    themeMode: '亮暗模式',
    themeName: '主题风格',
    language: '语言',
    about: '关于',
    version: '版本',
    installState: '安装状态',
    installed: '已安装到主屏',
    browser: '浏览器内运行',
  },
  theme: {
    system: '跟随系统',
    light: '亮色',
    dark: '暗色',
    terminal: 'Terminal',
    graphite: 'Graphite',
    paper: 'Paper',
  },
  pwa: {
    offlineReady: '已可离线使用',
    needRefresh: '有新版本',
    refresh: '刷新',
    offline: '当前离线，展示的是缓存内容',
  },
  notFound: {
    title: '页面不存在',
    back: '返回首页',
  },
}

export type Translation = typeof zhCN
