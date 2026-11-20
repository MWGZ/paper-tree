# Security policy

## Supported versions

The latest release is supported with security fixes. Please reproduce issues on the latest version before reporting.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a vulnerability.**

Use the repository's **private vulnerability reporting** feature (GitHub → Security → Report a vulnerability). If that is unavailable, contact the maintainer privately through the repository profile.

Please include:

- affected version/commit;
- operating system;
- reproduction steps;
- impact (for example: key disclosure, local file access, arbitrary code execution);
- any suggested fix.

We will acknowledge reports as soon as possible and coordinate disclosure.

## What stays local

PaperTree is a local-first desktop app:

- The DeepSeek API key is stored in `%APPDATA%\PaperTree\config.json` through Electron `safeStorage` (Windows DPAPI).
- The local server binds to `127.0.0.1` and is not intended to be exposed to the internet.
- Session data is stored at `%APPDATA%\PaperTree\db.json`.
- The app sends paper questions and selected excerpts to the model/search providers you configure. Do not use confidential or unpublished material unless you are allowed to send it to those providers.

## Secrets and data in this repository

Never commit:

- `.env` files or API keys;
- `app/data/` (developer session data);
- `%APPDATA%\PaperTree` contents;
- screenshots containing private papers or personal information;
- built installers, logs, or dependency directories.

If a key was ever committed, revoke it immediately at the provider. Removing the commit is not enough.

## Dependencies

The runtime server has **zero npm runtime dependencies** and uses Node.js built-ins. Desktop packaging uses Electron and electron-builder as dev dependencies. Dependabot is configured for weekly updates.
