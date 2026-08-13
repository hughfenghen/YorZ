import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { start, type ServeHandle } from '../index.js'

export interface TmpServiceHandle {
  cwd: string
  url: string
  port: number
  projectId: string
  apiPrefix: string
  handle: ServeHandle
  globalConfigPath: string
}

export async function startInTmpService(opts: { prefix?: string } = {}): Promise<TmpServiceHandle> {
  const prefix = opts.prefix ?? 'yorz-svc-'
  const cwd = await mkdtemp(join(tmpdir(), prefix))
  const cfgDir = await mkdtemp(join(tmpdir(), `${prefix}cfg-`))
  const globalConfigPath = join(cfgDir, 'config.json')
  const handle = await start({ cwd, port: 0, globalConfigPath })
  const list = await handle.registry.list()
  const projectId = list[0]?.id ?? ''
  if (!projectId) throw new Error('startInTmpService: project was not auto-registered')
  const apiPrefix = `${handle.url}api/projects/${projectId}`
  return { cwd, url: handle.url, port: handle.port, projectId, apiPrefix, handle, globalConfigPath }
}
