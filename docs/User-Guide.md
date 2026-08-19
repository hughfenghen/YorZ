# YorZ User Guide

This guide is for users who are connecting a project to YorZ for the first time. It explains installation, service startup and shutdown, configuration directories, and the core GUI workflows.

- [1. Installation](#1-installation)
- [2. Start the Service](#2-start-the-service)
- [3. Stop and Restart the Service](#3-stop-and-restart-the-service)
- [4. View Service Logs](#4-view-service-logs)
- [5. Add a Project](#5-add-a-project)
- [6. Configuration Directories](#6-configuration-directories)
  - [6.1 Project-level `.yorz/`](#61-project-level-yorz)
  - [6.2 Global Configuration Directory](#62-global-configuration-directory)
  - [6.3 Environment Variables](#63-environment-variables)
- [7. GUI Features](#7-gui-features)
  - [7.1 Layout](#71-layout)
  - [7.2 Appearance and Language](#72-appearance-and-language)
  - [7.3 Global Settings](#73-global-settings)
  - [7.4 Keyboard Shortcuts](#74-keyboard-shortcuts)
  - [7.5 Configure the Agent Method](#75-configure-the-agent-method)
  - [7.6 Chat](#76-chat)
  - [7.7 Custom Slash Commands](#77-custom-slash-commands)
  - [7.8 Create a New spec](#78-create-a-new-spec)
  - [7.9 Parallel Work in a New Project](#79-parallel-work-in-a-new-project)
  - [7.10 Append Tasks](#710-append-tasks)
  - [7.11 Debug Mode](#711-debug-mode)
  - [7.12 Content Annotations](#712-content-annotations)
  - [7.13 plan Decisions and Pending Confirmations](#713-plan-decisions-and-pending-confirmations)
  - [7.14 Review](#714-review)
  - [7.15 Project Commands](#715-project-commands)
  - [7.16 Diagram Viewer](#716-diagram-viewer)
  - [7.17 System Notifications and Version Updates](#717-system-notifications-and-version-updates)
- [8. Common Workflows](#8-common-workflows)
  - [8.1 Connect a Project for the First Time](#81-connect-a-project-for-the-first-time)
  - [8.2 Handle a New Requirement](#82-handle-a-new-requirement)
  - [8.3 Use Chat for Small Tasks](#83-use-chat-for-small-tasks)
  - [8.4 Work on Multiple Requirements in Parallel](#84-work-on-multiple-requirements-in-parallel)
  - [8.5 Append a Bug and Enter Debug Mode](#85-append-a-bug-and-enter-debug-mode)
  - [8.6 Capture a Custom Slash Command](#86-capture-a-custom-slash-command)

## 1. Installation

Install with pnpm:

```bash
pnpm add -g @yorz/cli
```

Or install with npm:

```bash
npm install -g @yorz/cli
```

After installation, run the following command to confirm that the CLI is available:

```bash
yorz --help
```

## 2. Start the Service

Run this command from any directory:

```bash
yorz serve
```

`yorz serve` starts the YorZ Service. It runs in the background by default. After the service starts, open this URL in your browser:

```text
http://localhost:7423
```

During startup, YorZ checks its bundled skills (`yorz-spec` / `yorz-debug` / `yorz-git-ops`). If one is missing or out of date, YorZ installs or updates it into the shared directory `~/.config/yorz/skills/`, which every YorZ project reuses. The three skills have distinct roles: `yorz-spec` drives the plan / tasks / execute state machine of a spec document, `yorz-debug` carries the "hypothesis → evidence → verification" discipline for hard bugs, and `yorz-git-ops` governs the commit, stage, and discard operations on the Review page.

Nothing is written into your Agents' own skills directories, so the skills never show up in non-YorZ sessions — YorZ passes the absolute `SKILL.md` path in the prompt instead, and the Agent reads it on demand. Leftovers from older versions under `~/.claude/skills/`, `~/.config/opencode/skills/`, and `~/.codex/skills/` are cleaned up automatically on every start (you can also run `yorz uninstall skills --legacy`).

When developing or troubleshooting the service, you can keep it in the foreground:

```bash
yorz serve --foreground
```

If the default port is already in use, specify another port:

```bash
yorz serve --port 7424
```

If the specified port is also taken, YorZ tries the next nine ports in order. The service only listens on the loopback address (`127.0.0.1` by default) and cannot be exposed to the network.

## 3. Stop and Restart the Service

Stop the background YorZ Service:

```bash
yorz serve stop
```

If no background service is running, the command reports that the service is not currently running. If stale runtime records exist, YorZ cleans them up.

Restart the background service (stop, then start again in the background):

```bash
yorz serve restart
```

`yorz serve restart` returns immediately; the actual stop-and-start work is done by a detached child process. This means the restart also succeeds when it is triggered from inside the service itself — for example when you click "Restart Service" in the GUI after a version update. Restarting interrupts running Agent tasks; once the service is back, send "continue" in Chat to let the Agent pick up where it left off.

## 4. View Service Logs

`yorz serve` runs in the background for long stretches, so the service writes its logs to `logs/` inside the global configuration directory:

```text
~/.config/yorz/logs/
```

The log directory follows the same resolution rules as the global configuration directory: with `XDG_CONFIG_HOME` set it becomes `$XDG_CONFIG_HOME/yorz/logs/`, and `YORZ_HOME` takes precedence over both, giving `$YORZ_HOME/logs/`.

The directory holds two files with distinct roles:

| File              | Contents                                                                                                                          | Size control                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `serve.log`       | **Main log**: service startup and shutdown, HTTP route errors and slow requests, Agent dispatch and failures, file watching, worktree operations, crash stack traces | Capped at 5MB per file, rotated with 1 archive |
| `serve-stdio.log` | Fallback capture of the background child process stdout/stderr (third-party libraries printing directly, fatal Node errors)        | Truncated on every start, so it never grows    |

Once `serve.log` reaches 5MB it is renamed to `serve.log.1` (overwriting the previous archive) and a fresh empty `serve.log` takes over. The log directory therefore occupies at most about 10MB and never grows without bound.

Every line uses a fixed format that is easy to filter with `grep`:

```text
[2026-07-28T12:00:00.000Z] [error] [http] route error {"method":"GET","path":"/api/projects","status":500}
```

The fields are, in order: ISO timestamp, log level (`debug` / `info` / `warn` / `error`), source module, message, and structured metadata.

Follow the log in real time:

```bash
tail -f ~/.config/yorz/logs/serve.log
```

To increase verbosity while troubleshooting, set the level and restart the service:

```bash
YORZ_LOG_LEVEL=debug yorz serve
```

`YORZ_LOG_LEVEL` accepts `debug` / `info` / `warn` / `error` and defaults to `info`. At `debug`, every HTTP request and every spec file change event is recorded as well.

> When reporting an issue, attach `serve.log` first. If the service exits immediately on startup, or no `serve.log` is produced at all, attach `serve-stdio.log` as well. The logs only record metadata such as sessionId, prompt length, and duration — prompt bodies and Agent output are never written to disk.

## 5. Add a Project

Before using the GUI for the first time, register your project directory with YorZ:

```bash
yorz add /path/to/your/project
```

`yorz add` performs these actions:

- Creates the project-level `.yorz/specs/` directory.
- Checks whether the target directory is a git repository. If it is not, YorZ asks interactively whether to run `git init`; in non-interactive scenarios, use `--yes` to allow it automatically. If the directory is not a git repository and you do not confirm, the command exits with an error.
- Adds `.yorz/tmp` to `.gitignore` so temporary runtime data is not committed to version control.
- Registers the project in the YorZ Service global project list.

After adding the project, refresh the GUI. The project will appear in the project list on the left.

## 6. Configuration Directories

YorZ uses the project-level directory to store spec documents and project-scoped settings, and the global directory to store the project list, personal preferences, and service runtime state.

### 6.1 Project-level `.yorz/`

The `.yorz/` directory at the project root is the YorZ working directory for the current project.

Common contents:

- `.yorz/config.json`: project configuration, including the project Agent override (`agent`), the spec document directory (`specsDir`), project commands (`commands`), and project-level custom slash commands (`customInstructions`). Committing this file to git lets your team share the same commands and slash commands.
- `.yorz/specs/`: the default spec document directory. Each spec is usually stored at `.yorz/specs/<spec-id>/spec.md`.
- `.yorz/specs/<spec-id>/debug.md`: the Debug mode record file. It appears only after the corresponding spec enters the Debug workflow.
- `.yorz/tmp/`: runtime temporary directory. It should not be committed to git (`yorz add` writes it into `.gitignore` for you). Inside it, `commands/` holds project command run records and logs, `sessions/` holds the session index, and `drafts/` holds attachments for spec drafts.

If you change the spec document directory in the GUI Project Configuration, new specs are written to the new directory. Existing specs remain in the old directory and need to be migrated manually when prompted.

### 6.2 Global Configuration Directory

YorZ's global configuration directory defaults to:

```text
~/.config/yorz
```

If `XDG_CONFIG_HOME` is set, YorZ uses:

```text
$XDG_CONFIG_HOME/yorz
```

If `YORZ_HOME` is set, it takes precedence and YorZ uses the directory it points to.

Common global files:

- `config.json`: **the single global configuration file today**. It holds the list of added projects, the global default Agent, session-end notification preferences, keyboard shortcuts, the sleep-inhibit policy, appearance preferences (color mode / theme / language), and global custom slash commands.
- `projects.json`: a legacy project list file. It is only read once as a fallback when `config.json` does not exist; all writes go to `config.json` afterwards.
- `runtime.json`: runtime records for the background Service.
- `skills/`: the shared bundled skills directory, containing `yorz-spec/`, `yorz-debug/`, and `yorz-git-ops/`.
- `logs/`: the service log directory, containing `serve.log` (the rotating main log) and `serve-stdio.log`. See [4. View Service Logs](#4-view-service-logs).

Personal preferences (appearance, theme, language, shortcuts, custom slash commands, and so on) now live in the user-level `config.json`, so they stay consistent across browsers and projects. Themes and languages stored in browser localStorage by older versions are migrated automatically on first load.

You usually do not need to edit the global configuration directory manually. Prefer managing it through `yorz add`, the GUI project list, GUI Global Settings, and `yorz serve stop` / `yorz serve restart`.

### 6.3 Environment Variables

| Variable                 | Purpose                                                                                  | Default          |
| ------------------------ | ---------------------------------------------------------------------------------------- | ---------------- |
| `YORZ_HOME`              | Global configuration directory; highest precedence                                       | unset            |
| `XDG_CONFIG_HOME`        | Second precedence; YorZ uses `$XDG_CONFIG_HOME/yorz`                                     | `~/.config/yorz` |
| `YORZ_LOG_LEVEL`         | Log level: `debug` / `info` / `warn` / `error`                                           | `info`           |
| `YORZ_WATCH_USE_POLLING` | Set to `1` to make file watching use polling — useful on network drives and in containers | disabled         |
| `YORZ_AGENT_CMD`         | Overrides the Agent launch command; takes precedence over project configuration. Mainly for testing and special integrations | unset |

## 7. GUI Features

### 7.1 Layout

The GUI uses a three-column layout:

1. **Project list (left)**: switch projects and open Project Configuration.
2. **Chat panel (middle)**: an always-present conversation area. It is visible on every page and the conversation is not interrupted when you navigate. The header of the panel has a "Collapse Chat" / "Expand Chat" button; when collapsed only a thin bar remains. The right edge of the panel can be dragged to resize it, and both the width and the collapsed state are remembered.
3. **Main area (right)**: spec list, spec detail, Review, Debug, command run detail, and other pages.

Spec-related pages in the main area have a "Fullscreen" button in the top-right corner (default shortcut `Ctrl+Shift+F`). Fullscreen temporarily collapses the project list and Chat panel so you can focus on the document; press `Esc` or click again to exit. Navigating between the spec list, detail, Review, and Debug pages does not reset the fullscreen state, and exiting restores whatever sidebar collapse settings you had chosen manually.

### 7.2 Appearance and Language

The far right side of the GUI header has a three-line settings entry. Open it to:

- `Switch Language`: 中文 / English.
- `Appearance`: two groups — Color Mode and Theme.
- `Global Settings`: opens the settings dialog, see [7.3](#73-global-settings).

**Color Mode** has three options:

- `System` (default): follows the operating system light/dark setting in real time.
- `Light`
- `Dark`

**Theme** has three options, freely combinable with any color mode:

- `Terminal` (default): monospace, terminal-style palette.
- `Graphite`: low-saturation neutral greys — high information density, low visual noise.
- `Paper`: warm off-white background with ink-black text, comfortable for long spec reading sessions.

Appearance and language are stored in the user-level `config.json` and apply across projects and browsers.

### 7.3 Global Settings

Click "Global Settings" in the header menu to open the dialog. The dialog has **no save button — every change is saved immediately**; the title shows "Saving..." followed by "Saved".

Global Settings has four groups:

- `Default Agent`: choose ClaudeCode, OpenCode, or Codex. Projects without a project-level override inherit this value. The initial value is ClaudeCode.
- `Session end alerts`: independently enable Banner alert and Sound alert. Both are disabled by default. When enabled, YorZ Service triggers system notifications or sound as a best-effort action after an Agent turn ends; unsupported environments do not affect the session completion flow.
- `Prevent sleep while tasks run`: three options, defaulting to "System default". "Prevent display sleep" keeps the screen on while an Agent session is running; "Prevent sleep" additionally keeps the system awake. It only takes effect while at least one session is running and is released as soon as all sessions finish. macOS, Linux, and Windows are supported; if the current system lacks the capability, YorZ falls back to "System default" without affecting task execution.
- `Shortcuts`: see [7.4](#74-keyboard-shortcuts).

### 7.4 Keyboard Shortcuts

The "Shortcuts" section of the Global Settings dialog lets you rebind three actions:

| Action            | Default binding | Behavior                                                       |
| ----------------- | --------------- | -------------------------------------------------------------- |
| `New Spec`        | `Ctrl+Shift+N`  | Opens the new spec page; opens another one if already there    |
| `Page fullscreen` | `Ctrl+Shift+F`  | Toggles fullscreen on the spec list / detail / Review / Debug pages |
| `Project Settings`| `Ctrl+Shift+S`  | Opens or closes the Project Configuration dialog                |

To change a binding:

1. Click "Record" on that row. The button becomes "Recording" and the binding shows "Press a new shortcut…".
2. Press the combination you want. It takes effect and is saved immediately.
3. While recording, press `Esc` to cancel, or `Backspace` / `Delete` to clear the binding.
4. Click "Reset" to restore the default binding (disabled when the binding is already the default).

If two actions end up with the same binding, the conflicting rows turn red with the message "Shortcut bindings must be unique" and the change is not saved. Note that the defaults use `Ctrl` on macOS as well, not `Command`. "Page fullscreen" and "Project Settings" are toggle actions and fire even when focus is inside a text field; "New Spec" is suppressed while you are typing.

Shortcut bindings are stored in the user-level `config.json`.

### 7.5 Configure the Agent Method

In the project list on the left side of the GUI, click the configuration entry next to a project (or press `Ctrl+Shift+S`) to open Project Configuration.

You can configure:

- `Agent`: choose Inherit global default, ClaudeCode, OpenCode, Codex, or a custom command.
- `Command (cmd)` and `Arguments (args, space-separated)`: fill these in only when choosing Custom.
- `Spec document directory`: a path relative to the project root. The default is `.yorz/specs`.

After saving, new specs, spec reruns, appended tasks, Chat conversations, and Review for this project use the resolved Agent: Inherit global default uses the global default Agent, while a concrete Agent or custom command takes precedence for this project.

### 7.6 Chat

The Chat panel is an always-present conversation area, well suited to small tasks that do not warrant a spec: asking about code, fixing a small bug, running a quick analysis. You can also escalate from here into the spec or debug workflow.

**The session list** sits at the top of the Chat panel:

- The heading shows "Sessions (N)", where N is the number of currently running sessions. Click the heading or the arrow to collapse the list.
- The `3 rows / 5 rows / 10 rows` control adjusts the visible height; the rest scrolls inside.
- Each row shows the Agent kind, the session title, and a relative timestamp (for example "5m ago"); hover to see the exact time. Running sessions show a spinner, and sessions with new activity move to the top automatically.
- Click any row to switch to that session. The list merges YorZ's own session index with the native session lists of the Agent CLIs, so sessions you started outside YorZ with claude / codex / opencode also appear here and can be continued.

**Sending messages**:

- `Enter` sends and `Shift+Enter` inserts a newline; confirming an IME candidate with Enter never sends by mistake.
- Type `@` to fuzzy-search and reference a file in the project. Type `/` at the start of a line to open the command palette, see [7.7](#77-custom-slash-commands).
- The paperclip button imports attachments — up to 10 files, 5MB each, supporting images, PDF, txt, and md. Images can also be pasted directly with Cmd/Ctrl-V.
- While a session is running, the send button becomes "Abort" so you can interrupt the current turn.
- The `+` "New Session" button below the composer returns the panel to a draft state. The actual session is created on the first send, so no empty sessions accumulate.

**Reading the conversation**:

- Messages are grouped by user turn: all Agent output and tool calls between two user messages are merged into a single bubble instead of one bubble per message.
- Tool calls are collapsed into a single `[Tool] ×N` line; expand it to see names, arguments, and results.
- `file/path:line` references in Agent replies are clickable and copy the path.
- Reloading the page restores the history from the Agent transcript, rendered identically to what you saw live.

**Remaining usage**: while Chat is in the empty draft state, a line below the placeholder shows the remaining model quota for the current Agent, for example "claude usage: 5-hour about 62% remaining (38% used, resets: …)". The line disappears once you select an existing session. Support varies by Agent: ClaudeCode and Codex can be queried directly, while OpenCode requires the `opencode-quota` plugin — the UI prints the install command for you. A failed query degrades to a short notice and never blocks sending messages.

### 7.7 Custom Slash Commands

Custom slash commands turn a prompt you use often into a single `/command`, such as `/git-commit` or `/review-diff`.

**Triggering**: type `/` **at the start of a line** in the Chat composer. A candidate list appears above the composer, ordered as:

1. `/yorz-debug`: start debug mode to troubleshoot difficult issues.
2. `/yorz-spec`: start spec-driven development from the current context.
3. Your custom commands (project-level first, then global).
4. `+ Add Command` as the last entry.

Keep typing to filter fuzzily, use `↑` / `↓` to select, `Enter` or `Tab` to confirm, and `Esc` to close.

**Managing commands**: hovering a custom command reveals two icons on the right — a pencil to "Edit" and a trash can to "Delete" (with a confirmation dialog). Choose the last entry, "Add Command", to open the create dialog. The built-in `/yorz-spec` and `/yorz-debug` cannot be edited or deleted.

**Command fields**:

| Field             | Description                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `Saved in`        | "This project" or "Global". This cannot be changed after saving — delete and recreate to move it |
| `Name`            | The command name; only letters, digits, underscores, and hyphens are allowed                     |
| `Description`     | Shown as the subtitle in the candidate list; falls back to "Custom command" when empty           |
| `Hidden Prompt`   | Sent to the Agent automatically and **never shown in the composer or the chat log** — this is the real content of the command |
| `Prefill Content` | Inserted into the composer when the command is selected, prefixed with `/command-name`; you can edit before sending |

**Storage and precedence**: global commands are stored in the user-level `config.json`; project commands in the project's `.yorz/config.json`. The two lists are merged with **project-level entries first and taking precedence** — a global command with the same name is hidden. Because project configuration travels with the repository, teammates get the same commands right after cloning.

**What happens on send**: YorZ resolves `/`-prefixed input on the server. Built-in commands expand into the corresponding skill instructions, custom commands attach their hidden prompt, and unmatched commands get an explanatory note — so the Agent never replies `Unknown command` again. The chat log always shows exactly what you typed.

### 7.8 Create a New spec

On the project home page, click "New spec" (or press `Ctrl+Shift+N`) to open the creation page.

When creating a spec, fill in:

- `Type`: `feat` for a new feature, `refct` for refactoring or extraction, and `fix` for bug fixes.
- `Requirement content`: the original request, pain points, expected result, related modules, or documents.
- `Attachments`: import attachments. Images can be pasted with Cmd/Ctrl-V.

The page remembers what you typed, so navigating away and back does not lose your draft; the memory is cleared once the spec is created successfully.

After clicking "Send", the Agent creates the spec document according to the `yorz-spec` skill and automatically enters the plan stage. After the document is written, the GUI navigates to the spec detail page.

### 7.9 Parallel Work in a New Project

When creating a new spec, you can enable "New project for parallel work".

This mode creates a separate git worktree for the new spec, so the work happens in a new branch and a new working directory without affecting the current main project workspace.

It is suitable when:

- The main project already has unfinished changes and you do not want to mix them.
- You need to work on multiple specs at the same time.
- You want to merge the work back into the main project from the list page after completion.

The parallel project appears as its own entry in the project list; its Chat sessions and command runs are isolated from the main project. After it is complete, use "Merge into main project" on the list page to merge the worktree changes back — the sessions from that worktree remain accessible after merging.

### 7.10 Append Tasks

On the spec detail page, click "Append task" to add a new requirement, refactor, or bug fix to an existing spec.

Appended tasks support three types:

- `feat New/expanded requirement`
- `refct Refactor/rewrite/extract`
- `fix Bug fix`

After submission, YorZ writes the appended content into the spec and automatically reopens the plan stage. The Agent analyzes the new content again, then continues task breakdown and execution.

If you select text in the body before appending a task, the appended record includes the referenced section and selected text so the Agent can understand the context.

### 7.11 Debug Mode

When appending a `fix` task, you can enable "debug mode". You can also enter it directly by sending `/yorz-debug` in Chat.

Debug mode makes the Agent use a stricter debugging workflow around "hypothesis -> evidence -> verification", and records the process in `debug.md` under the current spec directory.

It is suitable when:

- The reproduction conditions are complex.
- Ordinary fixes have failed multiple times.
- You need to preserve the investigation evidence chain.

When entering the Debug workflow, YorZ automatically attaches the project's **running project commands** (name, command line, pid, log file path) as context, so the Agent can read those logs while investigating. If nothing is running, the Agent is told to start the service itself or ask you to start it from the command menu. See [7.15 Project Commands](#715-project-commands).

When the current spec has a `debug.md`, the detail page shows a "Debug" entry where you can view the records.

### 7.12 Content Annotations

On the spec detail page, select a piece of text in the document. An action menu appears.

Available actions:

- `Annotate`: write feedback or additional information for the selected content.
- `Explain`: ask the Agent to explain the selected content.

Annotations are written back to the spec document and trigger the Agent to process it again. Use them to correct the Agent's understanding, add constraints, or point out inaccurate task descriptions.

### 7.13 plan Decisions and Pending Confirmations

During the plan stage, the Agent fills in "Current Analysis", "Technical Implementation Plan", and "Pending Confirmations".

When the plan contains information that must be judged by the user, the Agent leaves questions in "Pending Confirmations". The GUI shows a pending confirmation panel on the left side of the spec detail page.

Common pending confirmation types:

- Choice: multiple solutions are viable and the user needs to choose.
- Confirmation: the Agent has a recommended solution, but the impact is significant and needs approval or rejection.
- Free text: the user needs to provide open-ended information.

You can fill in and send all answers from the pending confirmation panel at once. After sending, the Agent reads the responses, updates the plan, and continues to the tasks or execute stage.

### 7.14 Review

On the spec detail page, click "Review" to open the Review page.

The Review page is used to inspect and process changes related to the current spec. Its git operations are governed by the bundled `yorz-git-ops` skill.

Main features:

- `Manual selection`: manually choose files to process.
- `Agent smart selection`: let the Agent decide which changes are related to the current spec.
- `Commit`: commit the selected changes.
- `Stage`: stage the selected changes.
- `Discard`: discard the selected changes. This operation cannot be undone and requires confirmation before execution.

After a spec is complete and verified, it is recommended to open the Review page and decide whether to commit, stage, or discard changes.

### 7.15 Project Commands

Project commands let you start long-running commands — `pnpm dev`, a watch build, a test runner — directly from the GUI. Their output is written to a log file that the Agent can read while troubleshooting.

**Managing commands**: click the terminal icon next to the "Spec list" heading on the project home page.

- Click "Add command" at the bottom, then fill in `Name` (for example `dev`) and `Command line` (for example `pnpm dev`). The command line runs through a shell, so pipes, `&&`, and environment-variable prefixes all work.
- Click a command in the menu to run it; the GUI then navigates to that run's detail page.
- Hover a row and click the trash icon to "Delete command". There is no edit entry — delete and recreate, or edit `commands` in `.yorz/config.json` directly.

Command definitions live in the project's `.yorz/config.json` and are shared through git. The working directory is always the project root (or the worktree root for parallel projects). Clicking a command that is already running does not start a second process.

**The running commands list** appears above the spec cards on the project home page and is hidden when there are no runs. Each row shows the status (`Running` / `Exited` / `Killed` / `Failed to start`), the name, the command line, and the elapsed time, plus two actions:

- `Restart`: clears the old record and log, then starts a fresh run.
- `Stop and clear`: terminates the process and deletes the run record and its log file, with a confirmation step.

Clicking a row opens the **command run detail page**, which shows the exit code, the duration, the log file path (displayed verbatim so you can paste it into an Agent prompt), and the live streaming output. While a run is active you can click "Stop" to end the process while keeping the record and log for later inspection.

Logs are stored at `.yorz/tmp/commands/<runId>.log` with an `index.json` alongside them. Run records are kept for 7 days and expired ones are cleaned up on service startup. All command child processes exit together with `yorz serve`, so no orphans are left behind.

### 7.16 Diagram Viewer

Fenced `mermaid` code blocks in spec documents are rendered as diagrams. Each diagram has a "Maximize diagram" button in the top-right corner that opens a fullscreen viewer:

- Scroll to zoom around the cursor, or use the "Zoom in" / "Zoom out" buttons.
- Drag to pan.
- "Reset view" returns to 1:1.
- Press `Esc` or click "Close diagram viewer" to exit.

The diagram is re-laid out as vector graphics, so text and lines stay crisp at any zoom level. The viewer fits the diagram to your viewport when it opens.

### 7.17 System Notifications and Version Updates

A bell button with a red dot appears in the GUI header, to the right of the `YorZ` brand name — **only when there is a notification**. Click it to open the "System Notifications" list.

Today the only notification type is version updates: the service checks npm for the latest release on startup and then every 12 hours. When a newer version exists, you see "New Version Available — YorZ x.y.z is available. Current version: a.b.c."

Available actions:

- `Update`: runs a global install of the latest version using your package manager (pnpm / npm / yarn / bun). The button shows "Updating…" while it runs.
- `Restart Service`: after a successful update the button becomes "Restart Service"; clicking it restarts YorZ Service and reloads the page. Restarting interrupts running tasks — send "continue" in Chat afterwards to resume.
- `Delete notification`: the trash icon on the right dismisses the entry. It reappears the next time a newer version is detected.

Notifications are not persisted: restarting `yorz serve` clears them and the next check regenerates them. A failed check (for example without network access) is only logged and never interrupts you.

## 8. Common Workflows

### 8.1 Connect a Project for the First Time

```bash
npm install -g @yorz/cli
yorz serve
yorz add /path/to/your/project
```

Then open `http://localhost:7423` and select the project on the left. While you are there, confirm the default Agent and appearance preferences from the header menu.

### 8.2 Handle a New Requirement

1. Click "New spec" on the project home page (or press `Ctrl+Shift+N`).
2. Choose `feat` and fill in the requirement content.
3. Click "Send" and wait for the Agent to create the spec and enter plan.
4. If there are pending confirmations, answer them in the panel and send.
5. The Agent continues task breakdown and execution.
6. After completion, open the "Review" page to process the changes.

### 8.3 Use Chat for Small Tasks

1. Click `+` in the Chat panel to start a new session.
2. Describe the task, use `@` to reference relevant files, and paste screenshots if needed.
3. If the task turns out bigger than expected, send `/yorz-spec` to let the Agent move into the spec-driven workflow using the current context.
4. If you hit a stubborn bug, send `/yorz-debug` to enter the Debug workflow.

### 8.4 Work on Multiple Requirements in Parallel

1. Enable "New project for parallel work" when creating a spec.
2. Let the Agent work on the task in the new worktree project.
3. The main project can continue handling other work.
4. After completion, use "Merge into main project" on the list page.

### 8.5 Append a Bug and Enter Debug Mode

1. If reproducing the bug requires a running service, start the matching command (for example `dev`) from the command menu first.
2. Click "Append task" on the spec detail page.
3. Choose `fix Bug fix`.
4. Enable "debug mode".
5. Fill in the reproduction, observed behavior, and expected result.
6. Click "Send". The Agent receives the running command's log path automatically and enters the Debug workflow.
7. View the `debug.md` records on the "Debug" page.

### 8.6 Capture a Custom Slash Command

1. Type `/` at the start of a line in the Chat composer and choose the last entry, "Add Command".
2. Pick where to save it: "Global" for yourself, "This project" to share it with the team.
3. Fill in the name (for example `git-commit`) and a description.
4. Write the full prompt in "Hidden Prompt", for example "Use git to commit files related to this session, following the repository's commit message conventions."
5. If you usually need to add details, put a template in "Prefill Content" — you can edit it after selecting the command and before sending.
6. Save, then invoke it with `/git-commit`.
