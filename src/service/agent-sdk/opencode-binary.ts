import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileWithoutWindow } from '../process.js'

/**
 * `opencode` 这个命令名在 PATH 上可能同时指向 v1 与 v2 两套 CLI：
 *
 * - v1：`opencode-ai` 包，输出 `1.19.3`，提供 `/session` 等老接口；
 * - v2：`@opencode/cli` 包，输出 `opencode v2.3.0`，只提供 `/api/*`。
 *
 * 而 `@opencode/cli` 同时声明了 `opencode` 与 `opencode2` 两个 bin，装成全局包
 * 时它的 `opencode` 会遮蔽用户原有的 v1。结果是 v1 适配器起服务时超时失败
 * （v2 打印的是 `server listening on …`，v1 的启动器只认
 * `opencode server listening`）。
 *
 * 这里把「这个二进制到底是哪一代」判定出来，让两个适配器各自挑对的那个。
 */

/** 探测结果：无法判定时按 unknown 处理，调用方应保持原有行为。 */
export type OpencodeGeneration = 'v1' | 'v2' | 'unknown'

const PROBE_TIMEOUT_MS = 5000

/**
 * 跑一次 `--version` 判断 CLI 代际。
 *
 * v1 输出纯版本号（`1.19.3`），v2 输出带前缀（`opencode v2.3.0`）。
 * 探测失败（文件不存在、不是可执行文件、超时）一律返回 `unknown`。
 */
export async function probeOpencodeGeneration(
  file: string,
  run: (cmd: string, args: string[]) => Promise<string> = defaultProbe,
): Promise<OpencodeGeneration> {
  try {
    const out = await run(file, ['--version'])
    const text = out.trim()
    if (!text) return 'unknown'
    // v2 的版本串里带 `v2.`（如 `opencode v2.3.0`）；v1 只有裸版本号。
    if (/\bv2\.\d/.test(text)) return 'v2'
    if (/^\d+\.\d+/.test(text)) return 'v1'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

async function defaultProbe(file: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileWithoutWindow(file, args, {
    timeout: PROBE_TIMEOUT_MS,
    encoding: 'utf8',
  })
  return `${stdout}\n${stderr}`
}

/**
 * 从 PATH 上找出第一个 `opencode` 可执行文件。
 *
 * @param pathEnv PATH 环境变量；默认取当前进程。
 * @param platform 目标平台，决定可执行文件名与 PATH 分隔符。
 * @returns 可执行文件绝对路径；找不到返回 undefined。
 */
export function findOpencodeOnPath(
  pathEnv: string | undefined = process.env.PATH,
  platform: NodeJS.Platform = process.platform,
): { file: string; dir: string } | undefined {
  if (!pathEnv) return undefined
  const separator = platform === 'win32' ? ';' : ':'
  const names = platform === 'win32' ? ['opencode.exe', 'opencode.cmd', 'opencode'] : ['opencode']
  for (const dir of pathEnv.split(separator)) {
    if (!dir) continue
    for (const name of names) {
      const file = join(dir, name)
      if (existsSync(file)) return { file, dir }
    }
  }
  return undefined
}

/**
 * 产出一个「只含 v1 `opencode`」的 PATH。
 *
 * 逐个检查 PATH 上的 `opencode`：一旦发现是 v2，就把所在目录从 PATH 里剔除，
 * 继续往后找。找不到 v1 时原样返回——此时交给上层按老办法报错。
 */
export async function pathWithoutV2Opencode(
  pathEnv: string | undefined = process.env.PATH,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  if (!pathEnv) return pathEnv
  const separator = platform === 'win32' ? ';' : ':'
  const names = platform === 'win32' ? ['opencode.exe', 'opencode.cmd', 'opencode'] : ['opencode']
  const kept: string[] = []
  const dropped = new Set<string>()
  for (const dir of pathEnv.split(separator)) {
    if (!dir) continue
    if (dropped.has(dir)) continue
    // 只在真正存在 `opencode` 的目录上做判定。
    const file = names.map((n) => join(dir, n)).find((f) => existsSync(f))
    if (!file) {
      kept.push(dir)
      continue
    }
    const generation = await probeOpencodeGeneration(file)
    if (generation === 'v2') {
      dropped.add(dir)
      continue
    }
    kept.push(dir)
  }
  return kept.join(separator)
}
