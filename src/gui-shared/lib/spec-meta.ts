/**
 * spec 列表行的展示元数据：阶段徽章配色、spec 类型配色、id 拆解。
 * 两端列表（桌面 SpecList / 移动 Specs）共用同一套视觉语义。
 */

import type { SpecStage } from '../api/index.js'

/*
 * Soft 徽章（设计稿「状态」形态）：15% 同色 tint 打底、文字用 stage 原色、
 * 30% 同色描边。相比实心填充，四个阶段在列表里靠色相区分而非靠色块抢注意，
 * 长列表扫读时噪音低得多。类名必须写成完整字面量，Tailwind JIT 才扫得到
 * （tailwind.config.cjs 的 content 已包含 src/gui-shared）。
 */
export const STAGE_BADGE: Record<string, string> = {
  plan: 'bg-stage-plan/15 text-stage-plan border-stage-plan/30',
  tasks: 'bg-stage-tasks/15 text-stage-tasks border-stage-tasks/30',
  execute: 'bg-stage-execute/15 text-stage-execute border-stage-execute/30',
  done: 'bg-stage-done/15 text-stage-done border-stage-done/30',
}

export const SPEC_TYPE_TEXT: Record<string, string> = {
  feat: 'text-success',
  refct: 'text-info',
  fix: 'text-destructive',
}

/** 取徽章类名，未知 stage 回退到 plan 的配色而不是渲染成无样式。 */
export function stageBadgeClass(stage: SpecStage | string): string {
  return STAGE_BADGE[stage] ?? STAGE_BADGE.plan!
}

/** 把 `YYMMDD.feat.some-name` 拆成三段；不符合该形状时返回 null。 */
export function splitSpecId(id: string): { prefix: string; type: string; suffix: string } | null {
  const [prefix, type, ...rest] = id.split('.')
  if (!prefix || !type || rest.length === 0) return null
  return { prefix, type, suffix: rest.join('.') }
}
