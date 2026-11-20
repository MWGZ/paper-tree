# Contributing to PaperTree

Thanks for taking the time to improve PaperTree. This is a small, dependency-light project: the server uses Node.js built-ins, the UI is plain HTML/CSS/JS, and Electron only wraps the local server.

## Before you start

- Please **do not** open a public issue for a security problem. Follow [SECURITY.md](SECURITY.md).
- Please **do not** commit API keys, `.env` files, `app/data/`, `%APPDATA%\PaperTree`, or screenshots of private papers.
- For larger changes, open an issue first so we can agree on the direction.

## Local setup

Requirements: **Node.js 24+** (for the built-in `fetch`, `node:test`, and modern ESM behavior).

```powershell
npm install          # only needed for Electron / packaging
npm run start        # local server: http://127.0.0.1:4317
npm run desktop      # Electron desktop window
npm run check        # syntax checks
```

No API key is required: without one the app runs in DEMO mode with an embedded example tree.

To use a real key during web development:

```powershell
Copy-Item app\.env.example app\.env
# edit app\.env
```

Never commit `app/.env`.

## Project layout

```text
desktop/              Electron main process + preload
app/server.mjs        local HTTP server and JSON API
app/lib/              DeepSeek, academic search, research pipeline, store
app/public/           annotation UI (annotate.*) and legacy map view (index.*)
docs/                 product and retrieval design notes
prototype/            early static prototype
```

## Checks

Before opening a pull request, run:

```powershell
npm run check
```

Then smoke-test the app:

```powershell
$env:DEMO = "1"
npm run start
```

Open <http://127.0.0.1:4317>, create a demo tree, create a note from a sentence, open the structure graph, and check the browser console for errors.

For desktop/installer changes also run:

```powershell
npm run pack
```

`npm run dist` produces a Windows installer in `dist/` (not committed).

## Pull requests

- Keep changes focused and explain the user-visible behavior.
- Include a screenshot or short recording for UI changes.
- Mention the OS and Node version you tested on.
- Do not include generated files: `node_modules/`, `dist/`, `app/data/`, `.env`, logs.
- By contributing, you agree that your contribution is licensed under the MIT License.

## Code style

- Plain ESM, 2-space indentation.
- Prefer small helpers over new dependencies. The server intentionally has zero runtime npm dependencies.
- Keep user data local. No telemetry, analytics, or silent network calls.
- API/provider errors should degrade gracefully (DEMO mode, partial results, or a clear message).
