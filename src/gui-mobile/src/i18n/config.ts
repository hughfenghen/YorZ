import { createI18n } from '@shared/i18n/create.js'
import { zhCN } from './zh-CN.js'
import { en } from './en.js'

/**
 * 初始化机制在共享层（@shared/i18n/create.ts），本文件只负责喂本端词典。
 * 词典刻意不与另一端合并：命名空间零重叠，合并会让两端互相牵制措辞。
 */
export const i18nInstance = createI18n(
  {
    'zh-CN': { translation: zhCN },
    en: { translation: en },
  },
  // 移动端在设置页里给了语言开关，选择必须活过刷新，所以落 localStorage。
  // 与主题同一条约定：移动端的外观真值在本地，不写服务端全局配置——
  // 否则在手机上改语言会顺带把桌面端也改掉。
  { persistKey: 'yorz.m.lang' },
)

export const { i18next, initPromise } = i18nInstance
