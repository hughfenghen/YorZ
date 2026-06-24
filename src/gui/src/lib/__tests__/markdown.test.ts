import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../markdown.js'

describe('renderMarkdown attachment rewrite', () => {
  it('does not rewrite when specId is not provided', () => {
    const html = renderMarkdown('![pic](attachments/a.png)')
    expect(html).toContain('src="attachments/a.png"')
  })

  it('rewrites relative attachments/* image src when specId is provided', () => {
    const html = renderMarkdown('![pic](attachments/a.png)', { specId: '260622.feat.demo' })
    expect(html).toContain('src="/api/specs/260622.feat.demo/attachments/a.png"')
  })

  it('rewrites attachments/* in link href and adds target=_blank', () => {
    const html = renderMarkdown('[doc](attachments/design.pdf)', { specId: 'x' })
    expect(html).toContain('href="/api/specs/x/attachments/design.pdf"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('leaves absolute URLs untouched', () => {
    const html = renderMarkdown('![pic](https://example.com/a.png)', { specId: 'x' })
    expect(html).toContain('src="https://example.com/a.png"')
  })

  it('leaves non-attachments relative paths untouched', () => {
    const html = renderMarkdown('![pic](other/path.png)', { specId: 'x' })
    expect(html).toContain('src="other/path.png"')
  })
})
