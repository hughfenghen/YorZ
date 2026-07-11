import i18next from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { zhCN } from './zh-CN.js'
import { en } from './en.js'

let initialized = false
const initPromise = i18next.use(LanguageDetector).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en },
  },
  fallbackLng: 'zh-CN',
  detection: {
    order: ['localStorage', 'navigator'],
    lookupLocalStorage: 'yorz.lang',
    caches: ['localStorage'],
  },
  interpolation: {
    escapeValue: false,
  },
})

initPromise.then(() => {
  initialized = true
})

export { i18next, initPromise, initialized }
