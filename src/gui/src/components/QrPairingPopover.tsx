import { createEffect, createSignal, Show } from 'solid-js'
import QRCode from 'qrcode'
import { QrCode } from 'lucide-solid'
import { api } from '@/lib/api'
import { Button } from './ui/button.jsx'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './ui/popover.jsx'
import { t } from '../i18n/index.js'

/**
 * 桌面 header 的配对入口：点击二维码 icon 弹出 Popover，向可信端 `GET /api/pairing/code`
 * 取一次性配对码，渲染二维码（内容为配对码纯文本）+ 码文本，供手机扫码或手输换设备令牌。
 */
export function QrPairingPopover() {
  const [open, setOpen] = createSignal(false)
  const [code, setCode] = createSignal<string | null>(null)
  const [dataUrl, setDataUrl] = createSignal<string | null>(null)
  const [error, setError] = createSignal(false)
  const [loading, setLoading] = createSignal(false)

  const loadCode = async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await api.getPairingCode()
      setCode(res.code)
      const url = await QRCode.toDataURL(res.code, { width: 220, margin: 1 })
      setDataUrl(url)
    } catch {
      setError(true)
      setCode(null)
      setDataUrl(null)
    } finally {
      setLoading(false)
    }
  }

  // 每次打开 Popover 都取一个新码（旧码一次性、单活动码，重开即刷新）。
  createEffect(() => {
    if (open()) void loadCode()
  })

  return (
    <Popover open={open()} onOpenChange={setOpen}>
      <PopoverTrigger as={Button} variant="ghost" size="icon" title={t('pairing.title')}>
        <QrCode class="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent class="w-72">
        <PopoverTitle class="mb-2 pr-6 text-sm font-semibold">{t('pairing.title')}</PopoverTitle>
        <p class="mb-3 text-xs text-muted-foreground">{t('pairing.hint')}</p>
        <Show
          when={!loading()}
          fallback={
            <div class="py-10 text-center text-sm text-muted-foreground">
              {t('pairing.loading')}
            </div>
          }
        >
          <Show
            when={!error()}
            fallback={
              <div class="flex flex-col items-center gap-3 py-4">
                <p class="text-sm text-destructive">{t('pairing.error')}</p>
                <Button size="sm" variant="outline" onClick={() => void loadCode()}>
                  {t('pairing.retry')}
                </Button>
              </div>
            }
          >
            <div class="flex flex-col items-center gap-3">
              <Show when={dataUrl()}>
                <img
                  src={dataUrl()!}
                  alt={t('pairing.title')}
                  class="h-44 w-44 rounded bg-white p-2"
                />
              </Show>
              <div class="font-mono text-lg tracking-widest">{code()}</div>
              <button
                type="button"
                class="text-xs text-muted-foreground underline"
                onClick={() => void loadCode()}
              >
                {t('pairing.refresh')}
              </button>
            </div>
          </Show>
        </Show>
      </PopoverContent>
    </Popover>
  )
}
