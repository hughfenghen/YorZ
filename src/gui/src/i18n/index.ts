import { createSignal, createMemo } from 'solid-js'
import { i18next, initPromise } from './config.js'

const [lng, setLng] = createSignal(i18next.language || 'zh-CN')
const [ready, setReady] = createSignal(i18next.isInitialized)

initPromise.then(() => {
  setLng(i18next.language || 'zh-CN')
  setReady(true)
})

i18next.on('languageChanged', (l) => setLng(l))

export function t(key: string, options?: Record<string, unknown>): string {
  return i18next.t(key, options)
}

export function useTranslation() {
  return {
    t,
    lng: createMemo(() => lng()),
    ready: createMemo(() => ready()),
    changeLanguage: (l: string) => i18next.changeLanguage(l),
  }
}

export { i18next, initPromise }
