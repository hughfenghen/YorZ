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
 * 检测策略：默认只按 navigator 语言判定、不落缓存，保证换系统语言后刷新即生效，
 * 不会被上一次的选择粘住。端上自己提供语言开关时（移动端设置页）才传 `persistKey`
 * 把选择落到 localStorage——桌面端的语言真值在服务端全局配置里，不需要这一层。
 */

export interface I18nResources {
  [lng: string]: { translation: unknown }
}

export interface CreateI18nOptions {
  fallbackLng?: string
  /**
   * 传入即启用 localStorage 持久化，值为存储键名。
   * 不传则维持「只跟随 navigator、不记忆」的行为。
   */
  persistKey?: string
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

export function createI18n(resources: I18nResources, options: CreateI18nOptions = {}): CreatedI18n {
  const { fallbackLng = 'zh-CN', persistKey } = options
  const initPromise = i18next.use(LanguageDetector).init({
    resources: resources as never,
    fallbackLng,
    detection: {
      order: persistKey ? ['localStorage', 'navigator'] : ['navigator'],
      caches: persistKey ? ['localStorage'] : [],
      // 只在启用时才带这个键：显式传 undefined 会把 detector 自己的默认键名覆盖掉
      ...(persistKey ? { lookupLocalStorage: persistKey } : {}),
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

  // 先读一次 lng 信号再转发：i18next.t 本身是个纯函数调用，不读信号的话
  // JSX 里的 t('…') 不依赖任何响应源，切语言后 Solid 根本不会重算，
  // 界面会停在旧语言上（只有直接用 lng() 的地方跟着变）。
  const t = (key: string, options?: Record<string, unknown>): string => {
    lng()
    return i18next.t(key, options)
  }

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
