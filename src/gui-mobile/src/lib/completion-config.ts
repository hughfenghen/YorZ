/**
 * `@` 搜索防抖，比桌面的 150ms 宽。服务端每次请求都是一次现场目录遍历
 * （`project-files.ts` 的 `walk`，无索引），手机还常走局域网/隧道，
 * 按桌面节奏打字会连着打出一串必然被丢弃的请求。
 *
 * 放在这里而不是某个组件里：会话输入栏与表单文本域各建各的 controller，
 * 数字留在其中一边就迟早会漂成两个。
 */
export const MOBILE_SEARCH_DEBOUNCE_MS = 280

/** 失焦要晚于候选项的抬起手势，否则候选条先消失、选中落空。 */
export const BLUR_CLOSE_DELAY_MS = 150
