import type { SpecDetail, SpecStore } from '../spec-store.js'
import type { SessionRunHandle } from '../session-manager.js'
import { getTelemetry } from './recorder.js'
import type { TelemetryPayload } from './types.js'

/** Everything `spec.stage` reports about one point in time. */
export interface SpecSnapshot {
  stage?: string
  tasksTotal: number
  tasksDone: number
  specBytes: number
}

const TASK_LINE = /^- \[( |x|X)\]/gm

/** Count checklist state without pulling in the lint/parse stack. */
export function snapshotSpec(detail: SpecDetail | null): SpecSnapshot | null {
  if (!detail) return null
  let tasksTotal = 0
  let tasksDone = 0
  for (const match of detail.body.matchAll(TASK_LINE)) {
    tasksTotal += 1
    if (match[1] !== ' ') tasksDone += 1
  }
  return {
    stage: detail.frontmatter.stage,
    tasksTotal,
    tasksDone,
    specBytes: Buffer.byteLength(detail.body, 'utf8'),
  }
}

export interface TrackSpecStageOptions {
  projectRoot: string
  store: SpecStore
  specId: string
  handle: SessionRunHandle
  /** Spec state as the route saw it, before the Agent could touch the file. */
  before: SpecDetail | null
  trigger?: string
}

/**
 * Record how one dispatch moved a spec through the state machine.
 *
 * The service never knew which stage a run started or ended in — the prompt is
 * fixed and `send()` carries no stage. Reading the frontmatter on both sides of
 * the run closes that gap and makes stage thrash (`plan → plan`) directly
 * visible. Fire-and-forget: a read failure must not affect the dispatch.
 */
export function trackSpecStage(opts: TrackSpecStageOptions): void {
  const { projectRoot, store, specId, handle, before, trigger } = opts
  const beforeSnapshot = snapshotSpec(before)
  handle.onDone(() => {
    void (async () => {
      let afterSnapshot: SpecSnapshot | null = null
      try {
        afterSnapshot = snapshotSpec(await store.read(specId))
      } catch {
        // spec deleted mid-run, or unreadable — report what we have
      }
      const payload: TelemetryPayload = {
        specId,
        trigger,
        traceId: handle.runId,
        sessionId: handle.sessionId,
        stageBefore: beforeSnapshot?.stage,
        stageAfter: afterSnapshot?.stage,
        tasksTotal: afterSnapshot?.tasksTotal,
        tasksDone: afterSnapshot?.tasksDone,
        tasksDoneBefore: beforeSnapshot?.tasksDone,
        specBytes: afterSnapshot?.specBytes,
      }
      getTelemetry(projectRoot).record('spec.stage', payload)
    })()
  })
}
