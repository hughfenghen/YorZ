# YorZ

**English** | [中文](./README_CN.md)

---

## Why YorZ

YorZ (Youzi) keeps vibe coding from turning your codebase into a black box.  
It also addresses a common failure mode in SDD (spec-driven development): developers stop reading the specs.

Agents can generate documents so quickly that developers get overloaded and pushed out of the workflow.  
YorZ turns spec information into visual, structured views and provides an SDD-focused UI, so Agents can work at full speed without burying developers in text.

![preview](./docs/preview.png)

## Features

- A built-in lightweight SDD skill with a UI tailored to SDD workflows
- Visual diagrams that make Agent output easier to read and understand
- One-click git worktree isolation, with concurrent Agents running on separate tasks
- Minimal user intervention while key decisions stay under user control
- Deep debug mode that uses evidence chains to diagnose hard problems Agents struggle to solve
- Works with mainstream Coding Agents including Claude Code, OpenCode, and Codex

[_User Guide_](./docs/User-Guide.md)

## Installation

```bash
pnpm add -g @yorz/cli

# or

npm install -g @yorz/cli
```

## Quick Start

### Start the Service

```bash
yorz serve
```

Start the YorZ Service. It runs in the background by default. Open `http://localhost:7423` in your browser to access the dashboard.

On startup, `yorz serve` automatically checks the `yorz-spec` skill. If it is missing or out of date, YorZ installs or updates it for every supported Agent (Claude Code / OpenCode / Codex) and prints the result before starting the Service.

To stop the background service:

```bash
yorz serve stop
```

### Add a Project

```bash
yorz add /path/to/your/project
```

Initialize the directory as a YorZ project by creating `.yorz/` config, registering it with the Service, and adding `.yorz/tmp` to `.gitignore`.

The `yorz-spec` skill teaches your AI Agent how to drive spec documents through the plan / tasks / execute / done stages. It is installed and kept up to date automatically by `yorz serve` as described above, so no manual installation is required.

## Command Reference

| Command           | Description                                                            |
| ----------------- | ---------------------------------------------------------------------- |
| `yorz serve`      | Start or reuse the background YorZ Service with multi-project support. |
| `yorz serve stop` | Stop the background YorZ Service.                                      |
| `yorz add <path>` | Initialize and register a directory as a YorZ project.                 |

### Global Options

| Option          | Description                   |
| --------------- | ----------------------------- |
| `-V, --version` | Print the YorZ version.       |
| `-h, --help`    | Display help for any command. |

## Development

```bash
# Install dependencies
pnpm install

# Build CLI + GUI
pnpm build

# Start the local CLI service in the foreground
pnpm dev:cli

# In another terminal, start the GUI dev server
pnpm dev:gui

# Run tests
pnpm test
```
