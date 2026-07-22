import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../markdown.js'

describe('renderMarkdown attachment rewrite', () => {
  it('does not rewrite when specId is not provided', () => {
    const html = renderMarkdown('![pic](attachments/a.png)')
    expect(html).toContain('src="attachments/a.png"')
  })

  it('keeps attachments/* in image src when specId is provided but projectId is missing', () => {
    const html = renderMarkdown('![pic](attachments/a.png)', { specId: '260622.feat.demo' })
    expect(html).toContain('src="attachments/a.png"')
    expect(html).not.toContain('/api/')
  })

  it('rewrites relative attachments/* image src when both specId and projectId are provided', () => {
    const html = renderMarkdown('![pic](attachments/a.png)', {
      specId: '260622.feat.demo',
      projectId: 'p1',
    })
    expect(html).toContain('src="/api/projects/p1/specs/260622.feat.demo/attachments/a.png"')
  })

  it('rewrites attachments/* in link href and adds target=_blank when projectId is provided', () => {
    const html = renderMarkdown('[doc](attachments/design.pdf)', { specId: 'x', projectId: 'p1' })
    expect(html).toContain('href="/api/projects/p1/specs/x/attachments/design.pdf"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('keeps attachments/* in link href untouched when projectId is missing', () => {
    const html = renderMarkdown('[doc](attachments/design.pdf)', { specId: 'x' })
    expect(html).toContain('href="attachments/design.pdf"')
    expect(html).not.toContain('target="_blank"')
  })

  it('leaves absolute URLs untouched', () => {
    const html = renderMarkdown('![pic](https://example.com/a.png)', {
      specId: 'x',
      projectId: 'p1',
    })
    expect(html).toContain('src="https://example.com/a.png"')
  })

  it('leaves non-attachments relative paths untouched', () => {
    const html = renderMarkdown('![pic](other/path.png)', { specId: 'x', projectId: 'p1' })
    expect(html).toContain('src="other/path.png"')
  })

  it('url-encodes projectId, specId and filename segments', () => {
    const html = renderMarkdown('![pic](attachments/a%20b.png)', {
      specId: 'spec.id',
      projectId: 'proj/id',
    })
    expect(html).toContain('src="/api/projects/proj%2Fid/specs/spec.id/attachments/a%2520b.png"')
  })
})

describe('renderMarkdown local file links', () => {
  it('renders absolute file paths as copy targets when enabled', () => {
    const html = renderMarkdown('[ChatPanel.tsx](/Users/me/repo/src/ChatPanel.tsx:158)', {
      fileLinks: 'copy',
      fileLinkTitle: 'Copy file path',
    })
    expect(html).toContain('data-file-link="true"')
    expect(html).toContain('data-file-path="/Users/me/repo/src/ChatPanel.tsx:158"')
    expect(html).toContain('role="button"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('title="Copy file path"')
    expect(html).not.toContain('href="/Users/me/repo/src/ChatPanel.tsx:158"')
  })

  it('leaves absolute file paths as normal links unless copy mode is enabled', () => {
    const html = renderMarkdown('[ChatPanel.tsx](/Users/me/repo/src/ChatPanel.tsx:158)')
    expect(html).toContain('href="/Users/me/repo/src/ChatPanel.tsx:158"')
    expect(html).not.toContain('data-file-link="true"')
  })

  it('supports Windows absolute file paths in copy mode', () => {
    const html = renderMarkdown('[main.ts](C:/repo/src/main.ts:10)', { fileLinks: 'copy' })
    expect(html).toContain('data-file-link="true"')
    expect(html).toContain('data-file-path="C:/repo/src/main.ts:10"')
    expect(html).not.toContain('href="C:/repo/src/main.ts:10"')
  })

  it('does not treat ordinary absolute app routes as file links', () => {
    const html = renderMarkdown('[project](/projects/current)', { fileLinks: 'copy' })
    expect(html).toContain('href="/projects/current"')
    expect(html).not.toContain('data-file-link="true"')
  })

  it('keeps attachment rewrite behavior when file copy mode is enabled', () => {
    const html = renderMarkdown('[doc](attachments/design.pdf)', {
      specId: 'x',
      projectId: 'p1',
      fileLinks: 'copy',
    })
    expect(html).toContain('href="/api/projects/p1/specs/x/attachments/design.pdf"')
    expect(html).toContain('target="_blank"')
    expect(html).not.toContain('data-file-link="true"')
  })
})

describe('renderMarkdown GFM task lists', () => {
  it('renders "- [ ]" as an unchecked, disabled checkbox with task-list-item class', () => {
    const html = renderMarkdown('- [ ] pending item')
    expect(html).toContain('class="task-list-item"')
    expect(html).toMatch(/<input[^>]*class="task-list-item-checkbox"[^>]*type="checkbox"/)
    expect(html).toContain('disabled=""')
    expect(html).not.toMatch(/<input[^>]*\schecked/)
    expect(html).toContain('pending item')
  })

  it('renders "- [x]" as a checked, disabled checkbox', () => {
    const html = renderMarkdown('- [x] done item')
    expect(html).toMatch(
      /<input[^>]*checked=""[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*checked=""/,
    )
    expect(html).toContain('disabled=""')
    expect(html).toContain('done item')
  })

  it('accepts uppercase "- [X]" as checked', () => {
    const html = renderMarkdown('- [X] done')
    expect(html).toMatch(
      /<input[^>]*checked=""[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*checked=""/,
    )
  })

  it('leaves non-task list items untouched inside a mixed list', () => {
    const html = renderMarkdown('- [ ] a\n- plain item\n- [x] b')
    const inputCount = (html.match(/<input[^>]*task-list-item-checkbox/g) ?? []).length
    expect(inputCount).toBe(2)
    expect(html).toContain('<li>plain item</li>')
  })

  it('does not turn "[ ]" inside a fenced code block into a checkbox', () => {
    const html = renderMarkdown('```\n- [ ] not a task\n```')
    expect(html).not.toContain('task-list-item-checkbox')
    expect(html).toContain('- [ ] not a task')
  })
})

describe('renderMarkdown controlled HTML (details folding)', () => {
  it('passes through details/summary tags as real HTML', () => {
    const html = renderMarkdown('<details>\n<summary>精确层</summary>\n\ninner text\n\n</details>')
    expect(html).toContain('<details>')
    expect(html).toContain('<summary>精确层</summary>')
    expect(html).toContain('</details>')
  })

  it('parses markdown inside a details block', () => {
    const html = renderMarkdown('<details>\n\n- item one\n\n</details>')
    expect(html).toContain('<details>')
    expect(html).toContain('<li>item one</li>')
  })

  it('allows <details open>', () => {
    const html = renderMarkdown('<details open>\n\ncontent\n\n</details>')
    expect(html).toContain('<details open>')
  })

  it('escapes script tags instead of rendering them', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes disallowed tags like div and img', () => {
    const html = renderMarkdown('<div>x</div>\n\n<img src=x onerror=alert(1)>')
    expect(html).not.toMatch(/<div>|<img/)
    expect(html).toContain('&lt;div&gt;')
    expect(html).toContain('&lt;img')
  })

  it('escapes details/summary carrying attributes (blocks event-handler injection)', () => {
    const html = renderMarkdown('<details onclick="evil()">\n\nx\n\n</details>')
    expect(html).not.toContain('<details onclick')
    expect(html).toContain('&lt;details onclick')
  })
})

describe('renderMarkdown mermaid mode', () => {
  const src = '```mermaid\nflowchart LR\n  A --> B\n```'

  it('emits a .mermaid placeholder div by default (SpecDetail behaviour)', () => {
    const html = renderMarkdown(src)
    expect(html).toContain('class="mermaid"')
    expect(html).toContain('data-mermaid-source=')
    expect(html).not.toContain('<pre><code')
  })

  it('emits a .mermaid placeholder div when mermaid is explicitly "diagram"', () => {
    const html = renderMarkdown(src, { mermaid: 'diagram' })
    expect(html).toContain('class="mermaid"')
  })

  it('renders a highlighted code block when mermaid is "code" (Chat behaviour)', () => {
    const html = renderMarkdown(src, { mermaid: 'code' })
    expect(html).toContain('<pre><code')
    expect(html).not.toContain('class="mermaid"')
    expect(html).toContain('flowchart LR')
  })

  it('keeps attachment rewrite working alongside mermaid: "code"', () => {
    const html = renderMarkdown('![pic](attachments/a.png)', {
      specId: '260622.feat.demo',
      projectId: 'p1',
      mermaid: 'code',
    })
    expect(html).toContain('src="/api/projects/p1/specs/260622.feat.demo/attachments/a.png"')
  })
})
