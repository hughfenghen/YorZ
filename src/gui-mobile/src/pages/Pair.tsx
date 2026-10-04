import { Show, createSignal, onCleanup, type Component } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import jsQR from 'jsqr'
import { Page } from '@/components/Page.jsx'
import { Button } from '@/components/ui/button.jsx'
import { showToast } from '@/components/Toast.jsx'
import { claimPairing } from '@/lib/pairing.js'
import { t } from '@/i18n/index.js'

type Mode = 'scan' | 'manual'

/**
 * 配对页：支持「摄像头扫码」或「手动输入配对码」两种方式。提交后以配对码换取设备令牌
 * 并持久化，随后回到首页。摄像头不可用（非安全上下文 / 无权限）时自动退化为手输。
 */
export const Pair: Component = () => {
  const navigate = useNavigate()
  const [mode, setMode] = createSignal<Mode>('manual')
  const [code, setCode] = createSignal('')
  const [submitting, setSubmitting] = createSignal(false)
  const [scanning, setScanning] = createSignal(false)
  const [cameraError, setCameraError] = createSignal(false)

  let video: HTMLVideoElement | undefined
  let canvas: HTMLCanvasElement | undefined
  let stream: MediaStream | null = null
  let raf = 0

  const stopCamera = () => {
    setScanning(false)
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      stream = null
    }
  }
  onCleanup(stopCamera)

  const submit = async (value: string) => {
    const v = value.trim()
    if (!v || submitting()) return
    setSubmitting(true)
    try {
      await claimPairing(v)
      stopCamera()
      showToast(t('pair.success'))
      navigate('/', { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.startsWith('401')) showToast(t('pair.invalid'), 'error')
      else if (msg.startsWith('429')) showToast(t('pair.tooMany'), 'error')
      else showToast(t('pair.failed'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const scanLoop = () => {
    if (!scanning() || !video || !canvas) return
    const w = video.videoWidth
    const h = video.videoHeight
    if (w && h) {
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        ctx.drawImage(video, 0, 0, w, h)
        const image = ctx.getImageData(0, 0, w, h)
        const result = jsQR(image.data, w, h)
        if (result && result.data.trim()) {
          void submit(result.data)
          return
        }
      }
    }
    raf = requestAnimationFrame(scanLoop)
  }

  const startCamera = async () => {
    setCameraError(false)
    const media = navigator.mediaDevices
    if (!window.isSecureContext || !media || !media.getUserMedia) {
      setCameraError(true)
      setMode('manual')
      return
    }
    try {
      stream = await media.getUserMedia({ video: { facingMode: 'environment' } })
      if (video) {
        video.srcObject = stream
        await video.play()
      }
      setScanning(true)
      raf = requestAnimationFrame(scanLoop)
    } catch {
      stopCamera()
      setCameraError(true)
      setMode('manual')
    }
  }

  const switchMode = (next: Mode) => {
    if (next === mode()) return
    if (next === 'manual') stopCamera()
    setMode(next)
  }

  return (
    <Page title={t('pair.title')}>
      <div class="flex flex-col gap-4">
        <p class="text-sm text-muted-foreground">{t('pair.intro')}</p>

        <div class="flex gap-2">
          <Button
            variant={mode() === 'scan' ? 'default' : 'outline'}
            size="sm"
            onClick={() => switchMode('scan')}
          >
            {t('pair.scan')}
          </Button>
          <Button
            variant={mode() === 'manual' ? 'default' : 'outline'}
            size="sm"
            onClick={() => switchMode('manual')}
          >
            {t('pair.manual')}
          </Button>
        </div>

        <Show when={mode() === 'scan'}>
          <div class="flex flex-col items-center gap-3">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={video}
              class="w-full max-w-sm rounded bg-black"
              playsinline
              muted
              autoplay
            />
            <canvas ref={canvas} class="hidden" />
            <Show when={!scanning()}>
              <Button size="sm" onClick={() => void startCamera()}>
                {t('pair.cameraStart')}
              </Button>
            </Show>
            <Show when={scanning()}>
              <p class="text-xs text-muted-foreground">{t('pair.scanHint')}</p>
            </Show>
            <Show when={cameraError()}>
              <p class="text-xs text-destructive">{t('pair.cameraUnavailable')}</p>
            </Show>
          </div>
        </Show>

        <Show when={mode() === 'manual'}>
          <form
            class="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void submit(code())
            }}
          >
            <label class="text-sm font-medium" for="pairing-code">
              {t('pair.codeLabel')}
            </label>
            <input
              id="pairing-code"
              type="text"
              value={code()}
              onInput={(e) => setCode(e.currentTarget.value)}
              placeholder={t('pair.codePlaceholder')}
              autocapitalize="characters"
              autocomplete="off"
              spellcheck={false}
              class="h-11 w-full rounded-md border border-input bg-background px-3 font-mono text-base uppercase tracking-widest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit" disabled={submitting() || !code().trim()}>
              {submitting() ? t('pair.submitting') : t('pair.submit')}
            </Button>
          </form>
        </Show>
      </div>
    </Page>
  )
}
