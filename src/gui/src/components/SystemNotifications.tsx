import { For, Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js'
import { Bell, RotateCw, Trash2 } from 'lucide-solid'
import { api, type SystemNotification } from '../lib/api.js'
import { subscribeSystemNotifications } from '../lib/sse.js'
import { waitForNotificationReset } from '../lib/system-notifications.js'
import { t } from '../i18n/index.js'
import { Button } from './ui/button.jsx'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './ui/popover.jsx'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.jsx'

export function SystemNotifications(): JSX.Element {
  const [items, setItems] = createSignal<SystemNotification[]>([])
  const [busyId, setBusyId] = createSignal<string | null>(null)

  async function load(): Promise<void> {
    try {
      setItems(await api.listSystemNotifications())
    } catch {
      // Header notifications are non-critical; keep the shell usable.
    }
  }

  createEffect(() => {
    void load()
    const unsubscribe = subscribeSystemNotifications(() => void load())
    onCleanup(unsubscribe)
  })

  async function remove(id: string): Promise<void> {
    setBusyId(id)
    try {
      await api.deleteSystemNotification(id)
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function update(id: string): Promise<void> {
    setBusyId(id)
    try {
      await api.updateSystemNotification(id)
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function restart(id: string): Promise<void> {
    setBusyId(id)
    try {
      await api.restartSystemNotification(id)
      setItems((current) => current.filter((item) => item.id !== id))
      await waitForNotificationReset({ id, list: api.listSystemNotifications })
      window.location.reload()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Show when={items().length > 0}>
      <Popover placement="bottom-start">
        <PopoverTrigger
          as={Button}
          variant="ghost"
          size="icon"
          class="relative h-8 w-8"
          title={t('systemNotifications.title')}
        >
          <Bell class="h-4 w-4" />
          <span class="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive" />
        </PopoverTrigger>
        <PopoverContent class="w-[26rem] max-w-[calc(100vw-2rem)] p-0">
          <div class="border-b px-3 py-2">
            <PopoverTitle class="text-sm font-semibold">
              {t('systemNotifications.title')}
            </PopoverTitle>
          </div>
          <div class="max-h-96 overflow-auto p-2">
            <For each={items()}>
              {(item) => (
                <div class="rounded-md px-2 py-2 text-sm">
                  <div class="flex items-center gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="font-medium">{notificationTitle(item)}</div>
                      <p class="mt-1 text-xs leading-5 text-muted-foreground">
                        {notificationMessage(item)}
                      </p>
                    </div>
                    <div class="flex shrink-0 items-center gap-1 self-center">
                      <Show when={item.kind === 'version-update'}>
                        <Show
                          when={item.action === 'restart-ready'}
                          fallback={
                            <Button
                              variant="ghost"
                              size="sm"
                              class="h-7 px-2 hover:bg-primary hover:text-primary-foreground"
                              disabled={busyId() === item.id || item.action === 'updating'}
                              onClick={() => void update(item.id)}
                            >
                              <Show
                                when={busyId() === item.id || item.action === 'updating'}
                                fallback={t('systemNotifications.update')}
                              >
                                <RotateCw class="mr-1 h-3.5 w-3.5 animate-spin" />
                                {t('systemNotifications.updating')}
                              </Show>
                            </Button>
                          }
                        >
                          <Tooltip openDelay={150} closeDelay={0}>
                            <TooltipTrigger
                              as={Button}
                              variant="ghost"
                              size="sm"
                              class="h-7 px-2 hover:bg-primary hover:text-primary-foreground"
                              disabled={busyId() === item.id}
                              onClick={() => void restart(item.id)}
                            >
                              {t('systemNotifications.restart')}
                            </TooltipTrigger>
                            <TooltipContent>{t('systemNotifications.restartTooltip')}</TooltipContent>
                          </Tooltip>
                        </Show>
                      </Show>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        title={t('systemNotifications.delete')}
                        disabled={busyId() === item.id}
                        onClick={() => void remove(item.id)}
                      >
                        <Trash2 class="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </PopoverContent>
      </Popover>
    </Show>
  )
}

function notificationTitle(item: SystemNotification): string {
  if (item.kind === 'version-update') return t('systemNotifications.versionTitle')
  return item.title
}

function notificationMessage(item: SystemNotification): string {
  if (item.kind !== 'version-update') return item.message
  return t('systemNotifications.versionMessage', {
    current: item.metadata?.currentVersion ?? '',
    latest: item.metadata?.latestVersion ?? '',
  })
}
