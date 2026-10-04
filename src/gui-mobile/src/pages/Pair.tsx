import { Show, createSignal, onCleanup, type Component } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import jsQR from 'jsqr'
import { Page } from '@/components/Page.jsx'
import { Button } from '@/components/ui/button.jsx'
import { showToast } from '@/components/Toast.jsx'
import { claimPairing } from '@/lib/pairing.js'
import { t } from '@/i18n/index.js'

/**
 * 配对页：手动输入配对码始终可用，摄像头扫码作为可选增强（点「扫码」开启摄像头）。
 * 提交后以配对码换取设备令牌并持久化，随后回到首页。摄像头不可用（非安全上下文 /
 * 无权限）时提示并退回手动输入。
 */
export const Pair: Component = () => {
  const navigate = useNavigate()
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
    }
  }

  return (
    <Page title={t('pair.title')}>
      <div class="flex flex-col gap-4">
        <p class="text-sm text-muted-foreground">{t('pair.intro')}</p>

        {/* 扫码：可选增强。video 始终挂载以绑定 ref，未扫码时隐藏；摄像头不可用时提示。 */}
        <div class="flex flex-col items-center gap-3">
          <Show when={!scanning()}>
            <Button variant="outline" size="sm" onClick={() => void startCamera()}>
              {t('pair.scan')}
            </Button>
          </Show>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={video}
            class={scanning() ? 'w-full max-w-sm rounded bg-black' : 'hidden'}
            playsinline
            muted
            autoplay
          />
          <canvas ref={canvas} class="hidden" />
          <Show when={scanning()}>
            <p class="text-xs text-muted-foreground">{t('pair.scanHint')}</p>
          </Show>
          <Show when={cameraError()}>
            <p class="text-xs text-destructive">{t('pair.cameraUnavailable')}</p>
          </Show>
        </div>

        {/* 手动输入：始终可用的主路径与兜底。 */}
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
      </div>
    </Page>
  )
}
