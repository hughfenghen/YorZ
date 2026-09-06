import { createTranscriptCache } from '@shared/lib/transcript-cache.js'

/**
 * 会话内容缓存：进详情页先画上次看过的消息，网络回来再决定要不要换。
 *
 * 与 `session-cache.ts`（会话列表）互补——那份缓存的是「有哪些会话」，这份缓存的是
 * 「某个会话说了什么」。两者一起把详情页那两段串行等待（先等列表说清这条会话属于
 * 哪个 spec，再等 transcript）从白屏变成可见内容。
 *
 * 刻意**只放内存、不落 localStorage**：一份 transcript 可以带上工具调用的完整输出，
 * 体量与列表元数据不是一个量级，写进 localStorage 既会顶爆配额，又要在每次冷启动时
 * 同步反序列化一大块 JSON——换来的只是冷启那一次的收益，而真正高频的是「列表 ⇄ 详情」
 * 之间来回跳转，那全发生在同一个页面生命周期内。
 *
 * 模块级单例，与 `active-project.ts` 同一范式：详情页每次导航都会卸载重建，缓存必须
 * 活在组件之外才有意义。
 */
export const transcriptCache = createTranscriptCache(20)
