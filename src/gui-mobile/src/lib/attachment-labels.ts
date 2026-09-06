import type { AttachmentLabels } from '@shared/lib/attachments.js'
import { t } from '@/i18n/index.js'

/**
 * 把移动端词典包成共享附件控制器要的 `AttachmentLabels`。
 *
 * 控制器住在 `gui-shared`，够不到任一端的 `t()`——两端的词典是分开的。
 * 每个字段是函数而非字符串：求值发生在报错那一刻，切语言后无需重建控制器。
 * 会话与新建 spec 两处共用同一份，避免同一条限制在两页出现两种说法。
 */
export function attachmentLabels(): AttachmentLabels {
  return {
    attachmentLimit: (max) => t('chat.attachmentLimit', { max }),
    unsupportedType: (name) => t('chat.attachUnsupported', { name }),
    unsupportedMime: (mime) => t('chat.attachUnsupportedMime', { mime }),
    fileTooLarge: (name) => t('chat.attachTooBig', { name }),
    attachmentRoomLimit: (room, current, max) => t('chat.attachTooMany', { room, current, max }),
  }
}
