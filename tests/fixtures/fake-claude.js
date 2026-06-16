#!/usr/bin/env node
// Minimal stand-in for `claude -p <prompt>` used in tests.
// Reads -p <prompt> from argv, writes 3 stdout chunks then exits 0.

const args = process.argv.slice(2)
let prompt = ''
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-p' && i + 1 < args.length) {
    prompt = args[i + 1]
    break
  }
}

const chunks = [`received prompt:\n`, `${prompt}\n`, `done\n`]
let i = 0
function emit() {
  if (i >= chunks.length) {
    process.exit(0)
    return
  }
  process.stdout.write(chunks[i++], () => setTimeout(emit, 5))
}
emit()
