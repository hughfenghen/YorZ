/**
 * 运行时长格式化：`m:ss`，超过一小时进位为 `h:mm:ss`。
 * 桌面端 RunningCommands 与移动端「扩展」页共用。
 */
export function formatDuration(
  startedAt: number,
  endedAt: number | undefined,
  now: number,
): string {
  const ms = Math.max(0, (endedAt ?? now) - startedAt)
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
