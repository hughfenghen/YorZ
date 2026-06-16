import { Show, type Component } from 'solid-js'

interface Props {
  open: boolean
  status: 'pending' | 'streaming' | 'done' | 'failed'
  text: string
  onClose: () => void
}

const STATUS_LABEL: Record<Props['status'], string> = {
  pending: '等待 Agent 响应…',
  streaming: '生成中…',
  done: '已完成',
  failed: '执行失败',
}

export const ExplainDrawer: Component<Props> = (props) => {
  return (
    <Show when={props.open}>
      <div class="explain-drawer-backdrop" onClick={props.onClose} />
      <aside class="explain-drawer">
        <header>
          <strong>Agent 解释</strong>
          <span class={`status status-${props.status}`}>{STATUS_LABEL[props.status]}</span>
          <button type="button" class="close" onClick={props.onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <pre class="output">{props.text || '（暂无输出）'}</pre>
        <footer class="muted">解释内容不会写入 spec 文档；关闭后即丢弃。</footer>
      </aside>
    </Show>
  )
}
