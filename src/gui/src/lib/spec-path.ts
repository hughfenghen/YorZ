import { specFilePath } from '@shared/lib/spec-path.js'
import { toast } from '../components/ui/toast.jsx'
import { t } from '../i18n/index.js'

// 路径拼装本身已上移到 gui-shared（移动端长按菜单要用同一份），这里保留原导出点：
// 桌面端 30+ 引用点与 e2e 用例因此零改动。
export { specFilePath }

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
