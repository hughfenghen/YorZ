#!/usr/bin/env node
// Stand-in for `claude --output-format stream-json --verbose -p <prompt>`.
// Emits a handful of JSONL events (system init, an assistant text chunk, a
// tool_use, a tool_result echoing the prompt, and a result), then exits 0.

const args = process.argv.slice(2)
let prompt = ''
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-p' && i + 1 < args.length) {
    prompt = args[i + 1]
    break
  }
}

const events = [
  { type: 'system', subtype: 'init' },
  { type: 'assistant', message: { content: [{ type: 'text', text: `received prompt:\n` }] } },
  { type: 'assistant', message: { content: [{ type: 'text', text: `${prompt}\n` }] } },
  {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'echo', input: { value: prompt } }] },
  },
  {
    type: 'user',
    message: { content: [{ type: 'tool_result', content: 'echo ok' }] },
  },
  { type: 'result', subtype: 'success', is_error: false },
]

let i = 0
function emit() {
  if (i >= events.length) {
    process.exit(0)
    return
  }
  process.stdout.write(JSON.stringify(events[i++]) + '\n', () => setTimeout(emit, 5))
}
emit()
