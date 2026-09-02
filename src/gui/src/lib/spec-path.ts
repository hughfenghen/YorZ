import { toast } from '../components/ui/toast.jsx'
import { t } from '../i18n/index.js'

/** spec 文档在项目内的相对路径，`@` 前缀便于直接粘进 agent 对话引用文件。 */
export function specFilePath(specId: string): string {
  return `@.yorz/specs/${specId}/spec.md`
}

/** 复制 spec 文档路径到剪贴板，并以 toast 反馈结果。 */
export async function copySpecPath(specId: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(specFilePath(specId))
    toast.success(t('specDetail.specPathCopied'))
  } catch {
    toast.error(t('specDetail.specPathCopyFailed'))
  }
}
