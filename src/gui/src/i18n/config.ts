import { createI18n } from '@shared/i18n/create.js'
import { zhCN } from './zh-CN.js'
import { en } from './en.js'

/**
 * 初始化机制在共享层（@shared/i18n/create.ts），本文件只负责喂本端词典。
 * 词典刻意不与另一端合并：命名空间零重叠，合并会让两端互相牵制措辞。
 */
export const i18nInstance = createI18n({
  'zh-CN': { translation: zhCN },
  en: { translation: en },
})

export const { i18next, initPromise } = i18nInstance
