# Fibonacci

Fibonacci is a deliberately small local tool for running steerable, read-only audits against a repository using your locally installed OpenCode CLI.

It does not upload or copy the selected repository. The Node server opens a native operating-system picker, receives the real local paths, and runs OpenCode in that repository.

## Version 1 workflow

1. Start Fibonacci with `npm run dev`.
2. Open the local URL printed in the terminal.
3. Select a repository folder, or select individual files from one repository.
4. Optionally enter a steer such as `security`, `accessibility`, `performance`, or a free-form instruction.
5. Press **Go**.
6. Fibonacci asks OpenCode to perform a read-only audit.
7. Each finding is written to its own Markdown file under `Audit Outputs/<run timestamp>/` inside the selected repository.

Fibonacci does not apply fixes, create commits, or open pull requests.

## Requirements

- Node.js 20 or newer
- OpenCode installed and authenticated on the same machine
- A supported native picker:
  - macOS: `osascript` (built in)
  - Windows: PowerShell and Windows Forms
  - Linux: `zenity` or `kdialog`

## Setup

```bash
cp .env.example .env
npm run dev
```

No `npm install` step is required because version 1 uses only Node.js built-ins.

To choose a specific OpenCode model, set `OPENCODE_MODEL` using the `provider/model` form accepted by OpenCode:

```dotenv
OPENCODE_MODEL=anthropic/claude-sonnet-4-5
```

OpenCode can also continue using credentials already configured through `opencode auth login`.

## Audit safety

Fibonacci supplies OpenCode with a restrictive runtime configuration:

- file editing is denied
- web access is denied
- user questions are denied because the run is non-interactive
- shell use is limited to a small set of inspection commands

The generated Markdown is written by Fibonacci after OpenCode returns structured findings. OpenCode itself is not given permission to modify the selected repository.

## File selection

Browser file inputs intentionally hide absolute local paths. Fibonacci therefore triggers the native OS picker from the local Node process rather than uploading files through the browser.

When individual files are selected, Fibonacci looks upward for their shared Git repository root. If no `.git` directory is found, their common parent directory is used.

## Mock mode

Set the following in `.env` to test the UI and output generation without OpenCode:

```dotenv
FIBONACCI_MOCK_OPENCODE=true
```
