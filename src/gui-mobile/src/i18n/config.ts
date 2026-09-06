import i18next from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { zhCN } from './zh-CN.js'
import { en } from './en.js'

/**
 * 与桌面端同样的 i18next 配置：只按 navigator 语言判定、不落缓存，
 * 保证换系统语言后刷新即生效，不会被上一次的选择粘住。
 */
let initialized = false
const initPromise = i18next.use(LanguageDetector).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en },
  },
  fallbackLng: 'zh-CN',
  detection: {
    order: ['navigator'],
    caches: [],
  },
  interpolation: {
    escapeValue: false,
  },
})

initPromise.then(() => {
  initialized = true
})

export { i18next, initPromise, initialized }
