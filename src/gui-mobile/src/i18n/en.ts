import type { Translation } from './zh-CN.js'

export const en: Translation = {
  app: {
    name: 'YorZ',
    tagline: 'Mobile',
  },
  nav: {
    home: 'Home',
    specs: 'Specs',
    settings: 'Settings',
  },
  home: {
    title: 'Home',
    scaffoldTitle: 'Mobile shell is ready',
    scaffoldBody:
      'Same stack as the desktop GUI: Solid + Vite + Tailwind + Kobalte + i18next, with PWA wired up.',
    scaffoldHint: 'No product features yet — this page is a placeholder.',
  },
  specs: {
    title: 'Specs',
    empty: 'Not wired up yet',
  },
  settings: {
    title: 'Settings',
    appearance: 'Appearance',
    themeMode: 'Light / dark',
    themeName: 'Theme',
    language: 'Language',
    about: 'About',
    version: 'Version',
    installState: 'Install state',
    installed: 'Installed to home screen',
    browser: 'Running in browser',
  },
  theme: {
    system: 'System',
    light: 'Light',
    dark: 'Dark',
    terminal: 'Terminal',
    graphite: 'Graphite',
    paper: 'Paper',
  },
  pwa: {
    offlineReady: 'Ready to work offline',
    needRefresh: 'Update available',
    refresh: 'Reload',
    offline: 'Offline — showing cached content',
  },
  notFound: {
    title: 'Page not found',
    back: 'Back to home',
  },
}
