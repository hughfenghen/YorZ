import { For, Show, createResource, createSignal, type Component } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Plus, Terminal, Trash2 } from 'lucide-solid'
import { api, type CommandDef } from '../lib/api.js'
import { projectHref } from '../lib/project.js'
import { Button } from './ui/button.jsx'
import { Input } from './ui/input.jsx'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu.jsx'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.jsx'
import { toast } from './ui/toast.jsx'
import { t } from '../i18n/index.js'

export interface CommandMenuProps {
  projectId: () => string
  /** Called after a run starts so the running-commands container can refresh. */
  onRunStarted?: () => void
}

export const CommandMenu: Component<CommandMenuProps> = (props) => {
  const navigate = useNavigate()
  const [defs, { refetch }] = createResource<CommandDef[], string>(props.projectId, (pid) =>
    pid ? api.listCommands(pid) : Promise.resolve([]),
  )
  const [addOpen, setAddOpen] = createSignal(false)
  const [name, setName] = createSignal('')
  const [cli, setCli] = createSignal('')
  const [submitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  async function onRun(def: CommandDef) {
    const pid = props.projectId()
    if (!pid) return
    try {
      // Idempotent per definition: an already-live command comes back as the
      // existing record rather than starting a second process, so navigating to
      // the run detail is the right outcome either way.
      const run = await api.runCommand(pid, def.id)
      toast.success(t('commands.started'))
      props.onRunStarted?.()
      navigate(projectHref(`commands/${encodeURIComponent(run.runId)}`))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function onDelete(def: CommandDef) {
    const pid = props.projectId()
    if (!pid) return
    try {
      await api.deleteCommand(pid, def.id)
      await refetch()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function onSubmit(e: Event) {
    e.preventDefault()
    const pid = props.projectId()
    if (!pid) return
    const n = name().trim()
    const c = cli().trim()
    if (!n || !c) return
    setSubmitting(true)
    setError(null)
    try {
      await api.createCommand(pid, { name: n, cli: c })
      setName('')
      setCli('')
      setAddOpen(false)
      await refetch()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div class="flex items-center">
      <DropdownMenu placement="bottom-start">
        <DropdownMenuTrigger
          as={Button}
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          title={t('commands.menuTitle')}
        >
          <Terminal class="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent class="min-w-56">
          <Show
            when={(defs() ?? []).length > 0}
            fallback={
              <div class="px-2 py-1.5 text-sm text-muted-foreground">{t('commands.empty')}</div>
            }
          >
            <For each={defs() ?? []}>
              {(def) => (
                <DropdownMenuItem
                  class="group flex items-center justify-between gap-2"
                  onSelect={() => void onRun(def)}
                >
                  <span class="flex min-w-0 flex-col">
                    <span class="truncate">{def.name}</span>
                    <span class="truncate font-mono text-[11px] text-muted-foreground">
                      {def.cli}
                    </span>
                  </span>
                  <button
                    type="button"
                    class="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                    title={t('commands.deleteDef')}
                    onClick={(e) => {
                      // Keep the click from bubbling into onSelect, which would
                      // run the command we are trying to delete.
                      e.stopPropagation()
                      e.preventDefault()
                      void onDelete(def)
                    }}
                  >
                    <Trash2 class="h-3.5 w-3.5 text-destructive" />
                  </button>
                </DropdownMenuItem>
              )}
            </For>
          </Show>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAddOpen(true)}>
            <Plus class="mr-1 h-4 w-4" />
            {t('commands.add')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* A Dialog, not a Popover: selecting the dropdown item closes the
          dropdown, which would unmount a Popover's anchor and hide it again
          immediately. The Dialog portals to body and needs no anchor. */}
      <Dialog
        open={addOpen()}
        onOpenChange={(o) => {
          setAddOpen(o)
          if (!o) setError(null)
        }}
      >
        <DialogContent class="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('commands.addTitle')}</DialogTitle>
          </DialogHeader>
          <form class="grid gap-4" onSubmit={(e) => void onSubmit(e)}>
            <label class="grid gap-2 text-sm font-medium" for="command-name">
              {t('commands.name')}
              <Input
                id="command-name"
                value={name()}
                placeholder={t('commands.namePlaceholder')}
                onInput={(e) => setName(e.currentTarget.value)}
                disabled={submitting()}
              />
            </label>
            <label class="grid gap-2 text-sm font-medium" for="command-cli">
              {t('commands.cli')}
              <Input
                id="command-cli"
                value={cli()}
                placeholder={t('commands.cliPlaceholder')}
                onInput={(e) => setCli(e.currentTarget.value)}
                disabled={submitting()}
              />
            </label>
            <Show when={error()}>
              <p class="m-0 text-destructive">{error()}</p>
            </Show>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddOpen(false)}
                disabled={submitting()}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={submitting() || !name().trim() || !cli().trim()}>
                {submitting() ? t('common.submitting') : t('commands.submit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
