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
    expect(html).toMatch(/<input[^>]*checked=""[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*checked=""/)
    expect(html).toContain('disabled=""')
    expect(html).toContain('done item')
  })

  it('accepts uppercase "- [X]" as checked', () => {
    const html = renderMarkdown('- [X] done')
    expect(html).toMatch(/<input[^>]*checked=""[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*checked=""/)
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
