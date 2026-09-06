import { describe, expect, it } from 'vitest'
import { diffLanguage, highlightLine, parsePatchRows } from '@shared/lib/diff-view.js'

/** A two-hunk patch: one pure addition, one deletion next to context. */
const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1
+const b = 2
 const c = 3
 const d = 4
@@ -10,3 +11,2 @@
 keep me
-drop me
 keep me too
`

describe('parsePatchRows', () => {
  it('returns no files for an empty patch', () => {
    expect(parsePatchRows('')).toEqual([])
  })

  it('splits a patch into files and hunks, keeping the hunk header verbatim', () => {
    const files = parsePatchRows(PATCH)
    expect(files).toHaveLength(1)
    expect(files[0].chunks).toHaveLength(2)
    expect(files[0].chunks[0].header).toBe('@@ -1,3 +1,4 @@')
  })

  it('numbers an added line only on the new side and marks it add', () => {
    const rows = parsePatchRows(PATCH)[0].chunks[0].rows
    const added = rows.find((r) => r.tone === 'add')
    expect(added).toEqual({ oldLn: '', newLn: 2, marker: '+', code: 'const b = 2', tone: 'add' })
  })

  it('numbers a deleted line only on the old side and marks it del', () => {
    const rows = parsePatchRows(PATCH)[0].chunks[1].rows
    const deleted = rows.find((r) => r.tone === 'del')
    expect(deleted).toEqual({ oldLn: 11, newLn: '', marker: '-', code: 'drop me', tone: 'del' })
  })

  it('numbers a context line on both sides and marks it normal', () => {
    const rows = parsePatchRows(PATCH)[0].chunks[0].rows
    expect(rows[0]).toEqual({ oldLn: 1, newLn: 1, marker: ' ', code: 'const a = 1', tone: 'normal' })
  })

  it('splits the leading marker off the code on every row', () => {
    for (const chunk of parsePatchRows(PATCH)[0].chunks) {
      for (const row of chunk.rows) {
        expect(row.marker).toHaveLength(1)
        expect(['+', '-', ' ']).toContain(row.marker)
      }
    }
  })

  it('handles a rename patch with no hunks', () => {
    const renamed = `diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
`
    const files = parsePatchRows(renamed)
    expect(files).toHaveLength(1)
    expect(files[0].chunks).toEqual([])
  })

  it('keeps a rename that also changed content, with its hunk', () => {
    const renamed = `diff --git a/old.ts b/new.ts
similarity index 80%
rename from old.ts
rename to new.ts
--- a/old.ts
+++ b/new.ts
@@ -1,1 +1,1 @@
-const a = 1
+const a = 2
`
    const chunks = parsePatchRows(renamed)[0].chunks
    expect(chunks).toHaveLength(1)
    expect(chunks[0].rows.map((r) => r.tone)).toEqual(['del', 'add'])
  })
})

describe('diffLanguage', () => {
  it('maps known extensions to a highlight.js grammar', () => {
    expect(diffLanguage('src/a.ts')).toBe('typescript')
    expect(diffLanguage('src/a.tsx')).toBe('typescript')
    expect(diffLanguage('README.md')).toBe('markdown')
  })

  it('is case-insensitive on the extension', () => {
    expect(diffLanguage('A.TS')).toBe('typescript')
  })

  it('falls back to plain text for an unknown extension', () => {
    expect(diffLanguage('a.wat')).toBeUndefined()
  })

  it('falls back to plain text for a path with no extension', () => {
    // `split('.').pop()` returns the whole name here — it must not be treated
    // as an extension that happens to collide with a grammar key.
    expect(diffLanguage('Makefile')).toBeUndefined()
  })
})

describe('highlightLine', () => {
  it('returns hljs markup for real code', () => {
    const html = highlightLine('const a = 1', 'typescript')
    expect(html).toContain('<span class="hljs-keyword">const</span>')
  })

  it('returns undefined without a language, so the caller renders plain text', () => {
    expect(highlightLine('const a = 1', undefined)).toBeUndefined()
  })

  it('returns undefined for an empty line', () => {
    expect(highlightLine('', 'typescript')).toBeUndefined()
  })

  it('does not throw on a syntactically broken fragment', () => {
    // Diff lines are fragments by nature; `ignoreIllegals` must absorb them.
    expect(() => highlightLine('} else {', 'typescript')).not.toThrow()
  })
})
