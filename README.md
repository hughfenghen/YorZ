# YorZ

English | [中文](./README_CN.md)

---

## Philosophy

// ...

## Features

// ...

## Installation

### Global Install

```bash
npm install -g @yorz/cli
```

### One-off Use

```bash
npx -p @yorz/cli yorz <command>
```

## Quick Start

### Step 1 — Start the Service

```bash
yorz serve
```

This launches the YorZ Service (HTTP + SSE + static GUI) in the background by default. Open `http://localhost:7423` in your browser to access the dashboard.

On startup, `yorz serve` automatically installs (or updates) the `yorz-spec` skill for all supported agents (Claude Code / OpenCode / Codex) when it's missing or out of date, logging the result before the Service starts.

Options:

```bash
yorz serve --port 8080    # custom port
yorz serve --open          # auto-open browser
yorz serve --foreground    # run in foreground
yorz serve stop            # stop the background service
```

### Step 2 — Add a Project

```bash
yorz add /path/to/your/project
```

This initializes the directory as a YorZ project (creates `.yorz/` config), registers it with the Service, and sets up `.yorz/tmp` in `.gitignore`.

The `yorz-spec` skill — which teaches your AI agent how to drive spec documents through plan / tasks / execute / done stages — is installed and kept up to date automatically by `yorz serve` (see Step 1), so there's no manual install step.

### Step 3 — Start Coding with Your Agent

Create a spec in your project:

```
.yorz/specs/260707.feat.my-feature/spec.md
```

Then ask your agent (Claude Code / OpenCode) to process it. The skill handles the rest — the GUI updates in real-time as the agent progresses.

## Command Reference

| Command                 | Description                                                      |
| ----------------------- | ---------------------------------------------------------------- |
| `yorz serve`            | Start or reuse the YorZ Service in the background. Multi-project. |
| `yorz serve stop`        | Stop the background YorZ Service.                                |
| `yorz add <path>`       | Initialize and register a directory as a YorZ project.           |
| `yorz uninstall skills` | Remove the yorz-spec skill from agents.                          |
| `yorz lint [paths...]`  | Lint `spec.md` / `review.md` files for structural rules.         |
| `yorz lint --all`       | Lint every spec under the project's specs directory.             |

### Global Options

| Option          | Description                   |
| --------------- | ----------------------------- |
| `-V, --version` | Print the YorZ version.       |
| `-h, --help`    | Display help for any command. |

## Documentation

- [Vision](./docs/Vision.md) — The Decision OS vision and core philosophy.
- [Product Design](./docs/Prod-Design.md) — Product design document.
- [Architecture](./docs/Architecture.md) — Technical architecture design.
- [Decision OS for Software Development](./docs/Decision-OS-for-Software-Development.md) — Conceptual deep dive.

## Development

```bash
# Install dependencies
pnpm install

# Build CLI + GUI
pnpm build

# Development mode (watch + serve)
pnpm dev

# Run tests
pnpm test
```

## License

[GNU Lesser General Public License v3.0 or later](./LICENSE) (LGPL-3.0-or-later)

[![License: LGPL-3.0-or-later](https://img.shields.io/badge/License-LGPL--3.0--or--later-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0.txt)
