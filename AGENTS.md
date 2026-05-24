# AGENTS.md

## Codex Agent Instructions

- Read existing code before changing behavior, especially the API contract in the native app and the React UI under `web`.
- Keep edits scoped. Avoid unrelated UI redesigns or broad refactors.
- Use `rg` for search and `apply_patch` for manual edits.
- Never commit tokens, cache files, logs, local machine paths, or release artifacts.
- Preserve `data\config.json` and `data\availability-cache.json` unless the user explicitly asks to reset local data.

## Project Overview

AniList Manager Portable is a Windows x64 Native AOT rewrite of AniList Manager. One native executable hosts a local HTTP API, serves the built React UI, and provides a system tray menu.

Goals:

- Ship one small portable ZIP with `AniListManagerPortable.exe` and `README.txt`.
- Require no Node, npm, node_modules, or .NET runtime for end users.
- Preserve the original app behavior: AniList auth, list edits, bulk actions, removal, and Sub/Dub availability.

## Stack

- Native app: C#/.NET 9 Native AOT.
- Tray: raw Win32 shell notification icon and menu APIs.
- HTTP server: `HttpListener` on `http://127.0.0.1:6767/`.
- Frontend: React/Vite in `web`; built assets are embedded into the native executable.
- Release script: PowerShell.

## Important Paths

- Native source: `native\`
- Web source: `web\`
- Asset generator/release packaging: `scripts\build-release.ps1`
- Release test rebuild: `scripts\rebuild-release-test.ps1`
- Portable data at runtime: `data\`
- Release output: `release\`

## Auth And Data

- Token lookup order is environment variables first, then portable `data\config.json`.
- `~\.config\anilist-cli\config.json` is import-only.
- The browser must never receive plaintext token values.
- Availability cache is stored in `data\availability-cache.json`.

## Testing and Rebuilding

- For a quick web-only build check, run `npm run build` from `web\`.
- To preview the React UI during development from PowerShell, prefer `Start-Process -FilePath npm.cmd -ArgumentList @('run','dev','--','--host','127.0.0.1','--port','5173') -WorkingDirectory 'C:\Scripts\AICodingProjects\anilist-manager-portable\web' -WindowStyle Hidden`; launching plain `npm` through `Start-Process` may fail to bind the dev server.
- After starting Vite, confirm it is serving with `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/`.
- End users should not need Node or npm; dev-server notes apply only to local frontend development.
- Release testing uses `C:\Scripts\AICodingProjects\anilist-manager-portable\release\AniListManagerPortable`.
- Use `scripts\rebuild-release-test.ps1` for release testing rebuilds. It rebuilds the release test folder without ZIP packaging, stops running `AniListManagerPortable` processes, backs up and restores `release\AniListManagerPortable\.runtime` and `release\AniListManagerPortable\data`, regenerates embedded web assets, and updates the executable.
- `scripts\rebuild-release-test.ps1` retries `npm ci` once after stopping workspace frontend Node or esbuild processes if they lock `web\node_modules`.
- Preserve release `data\*` during release testing rebuilds.
- Use `scripts\build-release.ps1` directly only when a packaged ZIP release is requested.
- Check the native publish output before reporting completion. If `link.exe` is unavailable, `scripts\build-release.ps1` falls back from Native AOT to trimmed self-contained single-file publish; report that distinction.
