/**
 * 过渡 shim：实现已迁至 src/gui-shared/lib/attachments.ts。
 *
 * 控制器本身不再持有 i18n，桌面端在此把 `t()` 包成 `AttachmentLabels` 注入，
 * 使两个调用点（ChatPanel / NewSpec）的文案仍走同一份 `newSpec.*` 键。
 */
import type { AttachmentLabels } from '@shared/lib/attachments.js'
import { t } from '../i18n/index.js'

export * from '@shared/lib/attachments.js'

export const attachmentLabels: AttachmentLabels = {
  attachmentLimit: (max) => t('newSpec.attachmentLimit', { max }),
  unsupportedType: (name) => t('newSpec.unsupportedType', { name }),
  unsupportedMime: (mime) => t('newSpec.unsupportedMime', { mime }),
  fileTooLarge: (name) => t('newSpec.fileTooLarge', { name }),
  attachmentRoomLimit: (room, current, max) =>
    t('newSpec.attachmentRoomLimit', { room, current, max }),
}
