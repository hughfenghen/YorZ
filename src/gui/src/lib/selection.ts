import {
  observeSelection as observeSelectionCore,
  type ObserveSelectionOptions,
  type SelectionCallback,
  type SelectionSnapshot,
} from '@shared/lib/selection.js'
import { t } from '../i18n/index.js'

/**
 * 桌面端薄封装：观察器本体已下沉共享层，这里只补上它刻意不持有的那一处
 * 本地化文案，让既有调用点 `observeSelection(el, setSnap)` 保持两参形态。
 */

export type { SelectionSnapshot, SelectionCallback }

export function observeSelection(
  container: HTMLElement,
  cb: SelectionCallback,
  options: Omit<ObserveSelectionOptions, 'noSectionLabel'> = {},
): () => void {
  return observeSelectionCore(container, cb, {
    ...options,
    noSectionLabel: t('selection.noSection'),
  })
}
