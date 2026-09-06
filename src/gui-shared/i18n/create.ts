import i18next, { type i18n as I18nInstance } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { createMemo, createSignal } from 'solid-js'

/**
 * 两端共用的 i18next 初始化 + Solid 桥接工厂。
 *
 * **词典不共享**：桌面端 25 个命名空间、移动端 8 个，零重叠，强行合并只会
 * 逼着一端为另一端的措辞妥协。共享的是这层「怎么初始化、怎么接进 Solid 信号」
 * 的机制，两端各自 `createI18n(自己的 resources)`。
 *
 * 检测策略：只按 navigator 语言判定、不落缓存，保证换系统语言后刷新即生效，
 * 不会被上一次的选择粘住。
 */

export interface I18nResources {
  [lng: string]: { translation: unknown }
}

export interface CreatedI18n {
  i18next: I18nInstance
  initPromise: Promise<unknown>
  t: (key: string, options?: Record<string, unknown>) => string
  useTranslation: () => {
    t: (key: string, options?: Record<string, unknown>) => string
    lng: () => string
    ready: () => boolean
    changeLanguage: (l: string) => void
  }
}

export function createI18n(resources: I18nResources, fallbackLng = 'zh-CN'): CreatedI18n {
  const initPromise = i18next.use(LanguageDetector).init({
    resources: resources as never,
    fallbackLng,
    detection: {
      order: ['navigator'],
      caches: [],
    },
    interpolation: {
      escapeValue: false,
    },
  })

  const [lng, setLng] = createSignal(i18next.language || fallbackLng)
  const [ready, setReady] = createSignal(i18next.isInitialized)

  initPromise.then(() => {
    setLng(i18next.language || fallbackLng)
    setReady(true)
  })

  i18next.on('languageChanged', (l) => setLng(l))

  const t = (key: string, options?: Record<string, unknown>): string => i18next.t(key, options)

  const useTranslation = () => ({
    t,
    lng: createMemo(() => lng()),
    ready: createMemo(() => ready()),
    changeLanguage: (l: string) => {
      void i18next.changeLanguage(l)
    },
  })

  return { i18next, initPromise, t, useTranslation }
}
