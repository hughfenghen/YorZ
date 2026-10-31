import { Show, type Component } from 'solid-js'
import { X } from 'lucide-solid'
import { Dialog } from './ui/dialog.jsx'

/**
 * Minimal image lightbox. Built on the Kobalte Dialog, so ESC and clicking the
 * backdrop close it for free; a top-right button closes it explicitly. The image
 * is capped at 80% of the viewport and letterboxed with `object-contain`.
 */
export const ImagePreview: Component<{
  src?: string
  alt?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}> = (props) => {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-50 bg-background/80 data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0" />
        <Dialog.Content class="group fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95">
          <Show when={props.src}>
            <img
              src={props.src}
              alt={props.alt}
              class="max-h-[80vh] max-w-[80vw] rounded-lg object-contain shadow-lg"
            />
          </Show>
          <Dialog.CloseButton
            class="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground opacity-0 shadow ring-offset-background transition hover:bg-background focus:outline-none focus-visible:opacity-100 focus-visible:ring-[1.5px] focus-visible:ring-ring focus-visible:ring-offset-2 group-hover:opacity-100"
            aria-label="Close"
          >
            <X class="h-4 w-4" />
          </Dialog.CloseButton>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
