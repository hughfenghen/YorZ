# YorZ User Guide

This guide is for users who are connecting a project to YorZ for the first time. It explains installation, service startup and shutdown, configuration directories, and the core GUI workflows.

- [1. Installation](#1-installation)
- [2. Start the Service](#2-start-the-service)
- [3. Stop the Service](#3-stop-the-service)
- [4. View Service Logs](#4-view-service-logs)
- [5. Add a Project](#5-add-a-project)
- [6. Configuration Directories](#6-configuration-directories)
  - [6.1 Project-level `.yorz/`](#61-project-level-yorz)
  - [6.2 Global Configuration Directory](#62-global-configuration-directory)
- [7. GUI Features](#7-gui-features)
  - [7.1 Global Configuration](#71-global-configuration)
  - [7.2 Configure the Agent Method](#72-configure-the-agent-method)
  - [7.3 Create a New spec](#73-create-a-new-spec)
  - [7.4 Parallel Work in a New Project](#74-parallel-work-in-a-new-project)
  - [7.5 Append Tasks](#75-append-tasks)
  - [7.6 Debug Mode](#76-debug-mode)
  - [7.7 Content Annotations](#77-content-annotations)
  - [7.8 plan Decisions and Pending Confirmations](#78-plan-decisions-and-pending-confirmations)
  - [7.9 Review](#79-review)
- [8. Common Workflows](#8-common-workflows)
  - [8.1 Connect a Project for the First Time](#81-connect-a-project-for-the-first-time)
  - [8.2 Handle a New Requirement](#82-handle-a-new-requirement)
  - [8.3 Work on Multiple Requirements in Parallel](#83-work-on-multiple-requirements-in-parallel)
  - [8.4 Append a Bug and Enter Debug Mode](#84-append-a-bug-and-enter-debug-mode)

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

During startup, YorZ checks its bundled skills (`yorz-spec` / `yorz-debug`). If one is missing or out of date, YorZ installs or updates it into the shared directory `~/.config/yorz/skills/`, which every YorZ project reuses. Nothing is written into your Agents' own skills directories, so the skills never show up in non-YorZ sessions — YorZ passes the absolute `SKILL.md` path in the prompt instead, and the Agent reads it on demand. Leftovers from older versions under `~/.claude/skills/`, `~/.config/opencode/skills/`, and `~/.codex/skills/` are cleaned up automatically (you can also run `yorz uninstall skills --legacy`).

When developing or troubleshooting the service, you can keep it in the foreground:

```bash
yorz serve --foreground
```

If the default port is already in use, specify another port:

```bash
yorz serve --port 7424
```

## 3. Stop the Service

Stop the background YorZ Service:

```bash
yorz serve stop
```

If no background service is running, the command reports that the service is not currently running. If stale runtime records exist, YorZ cleans them up.

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

- Checks whether the target directory is a git repository. In non-interactive scenarios, use `--yes` to allow YorZ to run `git init` automatically.
- Creates project-level `.yorz/` configuration.
- Registers the project in the YorZ Service global project list.
- Adds `.yorz/tmp` to `.gitignore` so temporary runtime data is not committed to version control.

After adding the project, refresh the GUI. The project will appear in the project list on the left.

## 6. Configuration Directories

YorZ mainly uses the project-level directory to store spec documents, and the global directory to store the project list and service runtime state.

### 6.1 Project-level `.yorz/`

The `.yorz/` directory at the project root is the YorZ working directory for the current project.

Common contents:

- `.yorz/config.json`: project configuration, including the project Agent override mode and the spec document directory. The default Agent can be inherited from global configuration.
- `.yorz/specs/`: the default spec document directory. Each spec is usually stored at `.yorz/specs/<spec-id>/spec.md`.
- `.yorz/specs/<spec-id>/debug.md`: the Debug mode record file. It appears only after the corresponding spec enters the Debug workflow.
- `.yorz/specs/<spec-id>/review.md`: the Review report file. It appears only after a review is generated.
- `.yorz/tmp/`: runtime temporary directory. It usually should not be committed to git.

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

- `projects.json`: the list of added projects, the global default Agent, and session-end notification preferences.
- `runtime.json`: runtime records for the background Service.
- `logs/`: the service log directory, containing `serve.log` (the rotating main log) and `serve-stdio.log`. See [4. View Service Logs](#4-view-service-logs).

You usually do not need to edit the global configuration directory manually. Prefer managing it through `yorz add`, the GUI project list, GUI Global Configuration, and `yorz serve stop`.

## 7. GUI Features

### 7.1 Global Configuration

The far right side of the GUI header has a three-line settings entry. Open it to switch languages or open the Global Configuration dialog.

Global Configuration includes:

- `Default Agent`: choose ClaudeCode, OpenCode, or Codex. Projects without a project-level override inherit this value. The initial value is ClaudeCode.
- `Session-end alerts`: independently enable Banner alert and Sound alert. Both are disabled by default. When enabled, YorZ Service triggers system notifications or sound as a best-effort action after an Agent turn ends; unsupported environments do not affect the session completion flow.

### 7.2 Configure the Agent Method

In the project list on the left side of the GUI, click the configuration entry next to a project to open Project Configuration.

You can configure:

- `Agent`: choose Inherit global default, ClaudeCode, OpenCode, Codex, or a custom command.
- `Command (cmd)` and `Arguments (args, space-separated)`: fill these in only when choosing Custom.
- `Spec document directory`: a path relative to the project root. The default is `.yorz/specs`.

After saving, new specs, spec reruns, appended tasks, and Review for this project use the resolved Agent: Inherit global default uses the global default Agent, while a concrete Agent or custom command takes precedence for this project.

### 7.3 Create a New spec

On the project home page, click "New spec" to open the creation page.

When creating a spec, fill in:

- `Type`: `feat` for a new feature, `refct` for refactoring or extraction, and `fix` for bug fixes.
- `Requirement content`: the original request, pain points, expected result, related modules, or documents.
- `Attachments`: import attachments. Images can be pasted with Cmd/Ctrl-V.

After clicking "Send", the Agent creates the spec document according to the `yorz-spec` skill and automatically enters the plan stage. After the document is written, the GUI navigates to the spec detail page.

### 7.4 Parallel Work in a New Project

When creating a new spec, you can enable "New project for parallel work".

This mode creates a separate git worktree for the new spec, so the work happens in a new branch and a new working directory without affecting the current main project workspace.

It is suitable when:

- The main project already has unfinished changes and you do not want to mix them.
- You need to work on multiple specs at the same time.
- You want to merge the work back into the main project from the list page after completion.

After the parallel project is complete, use "Merge into main project" on the list page to merge the worktree changes back.

### 7.5 Append Tasks

On the spec detail page, click "Append task" to add a new requirement, refactor, or bug fix to an existing spec.

Appended tasks support three types:

- `feat New/expanded requirement`
- `refct Refactor/rewrite/extract`
- `fix Bug fix`

After submission, YorZ writes the appended content into the spec and automatically reopens the plan stage. The Agent analyzes the new content again, then continues task breakdown and execution.

If you select text in the body before appending a task, the appended record includes the referenced section and selected text so the Agent can understand the context.

### 7.6 Debug Mode

When appending a `fix` task, you can enable "debug mode".

Debug mode makes the Agent use a stricter debugging workflow around "hypothesis -> evidence -> verification", and records the process in `debug.md` under the current spec directory.

It is suitable when:

- The reproduction conditions are complex.
- Ordinary fixes have failed multiple times.
- You need to preserve the investigation evidence chain.

When the current spec has a `debug.md`, the detail page shows a "Debug" entry where you can view the records.

### 7.7 Content Annotations

On the spec detail page, select a piece of text in the document. An action menu appears.

Available actions:

- `Annotate`: write feedback or additional information for the selected content.
- `Explain`: ask the Agent to explain the selected content.

Annotations are written back to the spec document and trigger the Agent to process it again. Use them to correct the Agent's understanding, add constraints, or point out inaccurate task descriptions.

### 7.8 plan Decisions and Pending Confirmations

During the plan stage, the Agent fills in "Current Analysis", "Technical Implementation Plan", and "Pending Confirmations".

When the plan contains information that must be judged by the user, the Agent leaves questions in "Pending Confirmations". The GUI shows a pending confirmation panel on the left side of the spec detail page.

Common pending confirmation types:

- Choice: multiple solutions are viable and the user needs to choose.
- Confirmation: the Agent has a recommended solution, but the impact is significant and needs approval or rejection.
- Free text: the user needs to provide open-ended information.

You can fill in and send all answers from the pending confirmation panel at once. After sending, the Agent reads the responses, updates the plan, and continues to the tasks or execute stage.

### 7.9 Review

On the spec detail page, click "Review" to open the Review page.

The Review page is used to inspect changes related to the current spec and generate a review report.

Main features:

- `Review changes`: dispatch the Agent to analyze the current changes and generate `review.md`.
- `Manual selection`: manually choose files to process.
- `Agent smart selection`: let the Agent decide which changes are related to the current spec.
- `Commit`: commit the selected changes.
- `Stage`: stage the selected changes.
- `Discard`: discard the selected changes. This operation cannot be undone and requires confirmation before execution.

After a spec is complete and verified, it is recommended to open the Review page, generate a review report first, then decide whether to commit, stage, or discard changes.

## 8. Common Workflows

### 8.1 Connect a Project for the First Time

```bash
npm install -g @yorz/cli
yorz serve
yorz add /path/to/your/project
```

Then open `http://localhost:7423` and select the project on the left.

### 8.2 Handle a New Requirement

1. Click "New spec" on the project home page.
2. Choose `feat` and fill in the requirement content.
3. Click "Send" and wait for the Agent to create the spec and enter plan.
4. If there are pending confirmations, answer them in the panel and send.
5. The Agent continues task breakdown and execution.
6. After completion, open the "Review" page to generate a review report and process the changes.

### 8.3 Work on Multiple Requirements in Parallel

1. Enable "New project for parallel work" when creating a spec.
2. Let the Agent work on the task in the new worktree project.
3. The main project can continue handling other work.
4. After completion, use "Merge into main project" on the list page.

### 8.4 Append a Bug and Enter Debug Mode

1. Click "Append task" on the spec detail page.
2. Choose `fix Bug fix`.
3. Enable "debug mode".
4. Fill in the reproduction, observed behavior, and expected result.
5. Click "Send" and wait for the Agent to enter the Debug workflow.
6. View the `debug.md` records on the "Debug" page.
