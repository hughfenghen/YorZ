# YorZ

English | [中文](./README_CN.md)

---

## Philosophy

YorZ believes a product is not just the final code, but the accumulated result of the initial idea and every key decision along the way.

YorZ connects requirement analysis, solution decisions, task execution, and change review into a traceable development path through spec documents, a visual interface, and Agent workflows.

![preview](./docs/preview.png)

## Features

- Manage spec-driven development through a graphical interface
- Present Agent-generated technical plans as visual diagrams to improve reading comprehension
- Minimize user intervention in the flow while preserving authority over key decisions
- Provide a deep debug mode that uses evidence chains to diagnose hard problems Agents struggle to solve
- Support mainstream Coding Agents including Claude Code, OpenCode, and Codex

## Installation

```bash
pnpm add -g @yorz/cli
```

```bash
npm install -g @yorz/cli
```

## Quick Start

### Start the Service

```bash
yorz serve
```

Start the YorZ Service. It runs in the background by default. Open `http://localhost:7423` in your browser to access the dashboard.

On startup, `yorz serve` automatically checks the `yorz-spec` skill. When it is missing or out of date, YorZ installs or updates it for all supported Agents (Claude Code / OpenCode / Codex), then prints the result before starting the Service.

To stop the background service:

```bash
yorz serve stop
```

### Add a Project

```bash
yorz add /path/to/your/project
```

Initialize the directory as a YorZ project by creating `.yorz/` config, registering it with the Service, and adding `.yorz/tmp` to `.gitignore`.

The `yorz-spec` skill teaches your AI Agent how to drive spec documents through the plan / tasks / execute / done stages. It is installed and kept up to date automatically by `yorz serve` (see Step 1), so no manual installation is required.

## Command Reference

| Command           | Description                                                      |
| ----------------- | ---------------------------------------------------------------- |
| `yorz serve`      | Start or reuse the YorZ Service in the background. Multi-project. |
| `yorz serve stop` | Stop the background YorZ Service.                                |
| `yorz add <path>` | Initialize and register a directory as a YorZ project.           |

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

# Development mode (watch + start service)
pnpm dev

# Run tests
pnpm test
```
