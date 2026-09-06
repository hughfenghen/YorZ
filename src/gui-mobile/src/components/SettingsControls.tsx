import { For, type Component, type JSX } from 'solid-js'
import { cn } from '@/lib/cn'

/**
 * 设置页的三个基础控件：分组、分段选择、开关。
 *
 * 分段控件优先于下拉菜单：选项少的时候少一次弹层交互，
 * 而且当前值和其余候选同时可见，不用点开才知道选了什么。
 */

export const Group: Component<{ title: string; children: JSX.Element }> = (props) => (
  <section class="mb-6">
    <h2 class="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {props.title}
    </h2>
    <div class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {props.children}
    </div>
  </section>
)

export function Segmented<T extends string>(props: {
  label: string
  options: readonly { value: T; label: string }[]
  value: () => T
  onChange: (value: T) => void
}): JSX.Element {
  return (
    // 允许折行：选项一多（项目设置的 Agent 类型就有四档）一行放不下，
    // 不折行的话整组被裁在屏幕外，只剩前两档可点。先让整组落到第二行，
    // 第二行仍放不下时组内自己再折一次——宁可占两行，也不截断选项。
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
      <span class="shrink-0 text-sm">{props.label}</span>
      <div
        class="flex max-w-full shrink-0 flex-wrap overflow-hidden rounded-md border border-border"
        role="group"
        aria-label={props.label}
      >
        <For each={props.options}>
          {(option) => (
            <button
              type="button"
              class={cn(
                'min-h-9 px-3 text-xs transition-colors',
                props.value() === option.value
                  ? 'bg-primary-soft text-foreground'
                  : 'bg-background text-muted-foreground',
              )}
              aria-pressed={props.value() === option.value}
              onClick={() => props.onChange(option.value)}
            >
              {option.label}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

/** 布尔开关。用原生 checkbox 的语义 + 自绘轨道，省掉一个组件依赖。 */
export const Toggle: Component<{
  label: string
  checked: () => boolean
  onChange: (next: boolean) => void
}> = (props) => (
  <label class="flex items-center justify-between gap-3 px-4 py-3">
    <span class="min-w-0 flex-1 text-sm">{props.label}</span>
    <input
      type="checkbox"
      class="peer sr-only"
      checked={props.checked()}
      onChange={(e) => props.onChange(e.currentTarget.checked)}
    />
    <span
      aria-hidden="true"
      class={cn(
        'relative h-6 w-10 shrink-0 rounded-full transition-colors peer-focus-visible:ring-[1.5px] peer-focus-visible:ring-ring',
        props.checked() ? 'bg-primary' : 'bg-muted',
      )}
    >
      <span
        class={cn(
          'absolute top-0.5 size-5 rounded-full bg-background shadow transition-[left]',
          props.checked() ? 'left-[1.125rem]' : 'left-0.5',
        )}
      />
    </span>
  </label>
)

/** 单行文本输入，用于项目设置里的自定义 cmd / args。 */
export const TextField: Component<{
  label: string
  hint?: string
  value: () => string
  placeholder?: string
  onCommit: (next: string) => void
}> = (props) => (
  <div class="flex flex-col gap-1 px-4 py-3">
    <span class="text-sm">{props.label}</span>
    <input
      type="text"
      class="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring"
      value={props.value()}
      placeholder={props.placeholder}
      autocapitalize="off"
      autocomplete="off"
      spellcheck={false}
      // 移动端没有「离开表单再点保存」的习惯，改完收起键盘即落盘
      onChange={(e) => props.onCommit(e.currentTarget.value)}
    />
    {props.hint ? <span class="text-xs text-muted-foreground">{props.hint}</span> : null}
  </div>
)
