import { describe, expect, it } from 'vitest'
import { formatSpecUpdatedAt } from '../time.js'

describe('formatSpecUpdatedAt', () => {
  it('returns datetime strings as-is', () => {
    expect(formatSpecUpdatedAt('2026-06-30 15:42:07')).toBe('2026-06-30 15:42:07')
  })

  it('returns legacy date strings as-is', () => {
    expect(formatSpecUpdatedAt('2026-06-30')).toBe('2026-06-30')
  })

  it('strips surrounding quotes that may leak from raw YAML', () => {
    expect(formatSpecUpdatedAt("'2026-06-30 15:42:07'")).toBe('2026-06-30 15:42:07')
    expect(formatSpecUpdatedAt('"2026-06-30"')).toBe('2026-06-30')
  })

  it('returns empty string for empty / null / undefined input', () => {
    expect(formatSpecUpdatedAt('')).toBe('')
    expect(formatSpecUpdatedAt(undefined)).toBe('')
    expect(formatSpecUpdatedAt(null)).toBe('')
  })

  it('falls back to the original string for unexpected shapes', () => {
    expect(formatSpecUpdatedAt('next week')).toBe('next week')
  })
})
