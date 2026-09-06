/**
 * 过渡 shim：实现已迁至 src/gui-shared/api/index.ts，两端共用。
 * 保留本文件是为了让桌面端 30+ 处 `@/lib/api` 引用与单测路径零改动；
 * 后续可按文件逐步收敛到 `@shared/api/index.js`。
 */
export * from '@shared/api/index.js'
