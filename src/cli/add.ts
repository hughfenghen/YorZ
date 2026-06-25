import { addProject, prepareProjectDir, type GlobalProjectEntry } from '../service/global-config.js'

export interface RunAddOptions {
  path: string
  cwd?: string
  globalConfigPath?: string
}

export interface RunAddResult {
  entry: GlobalProjectEntry
  created: boolean
}

export async function runAdd(opts: RunAddOptions): Promise<RunAddResult> {
  const abs = await prepareProjectDir(opts.path, opts.cwd)
  return await addProject(abs, opts.globalConfigPath)
}
