import { createRoot } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { createMediaQuery, matchesMediaQuery, MOBILE_MEDIA_QUERY } from '../media-query.js'

describe('matchesMediaQuery', () => {
  it('无 matchMedia 环境（node/SSR）返回 false 而不抛错', () => {
    expect(matchesMediaQuery(MOBILE_MEDIA_QUERY)).toBe(false)
    expect(matchesMediaQuery('(min-width: 0px)')).toBe(false)
  })
})

describe('createMediaQuery', () => {
  it('无 matchMedia 环境返回恒为 false 的可用 signal', () => {
    createRoot((dispose) => {
      const isMobile = createMediaQuery(MOBILE_MEDIA_QUERY)
      expect(isMobile()).toBe(false)
      dispose()
    })
  })

  it('断点常量为 Tailwind md 档', () => {
    expect(MOBILE_MEDIA_QUERY).toBe('(max-width: 767px)')
  })
})
