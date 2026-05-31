# AGENTS.md

## Codex Agent Instructions

- Read existing code before changing behavior, especially the API contract in the native app and the React UI under `web`.
- Keep edits scoped. Avoid unrelated UI redesigns or broad refactors.
- Use `rg` for search and `apply_patch` for manual edits.
- Never commit tokens, cache files, logs, local machine paths, or release artifacts.
- Preserve `data\config.json` and `data\availability-cache.json` unless the user explicitly asks to reset local data.

## Project Overview

AniList Manager Portable is a Windows x64 Native AOT application. One native executable hosts a local HTTP API, serves the built React UI, and provides a system tray menu.

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
- To preview the React UI during development from PowerShell, prefer `Start-Process -FilePath npm.cmd -ArgumentList @('run','dev','--','--host','127.0.0.1','--port','5173') -WorkingDirectory '<repo>\web' -WindowStyle Hidden`; launching plain `npm` through `Start-Process` may fail to bind the dev server.
- After starting Vite, confirm it is serving with `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/`.
- End users should not need Node or npm; dev-server notes apply only to local frontend development.
- Release testing uses `release\AniListManagerPortable`.
- Use `scripts\rebuild-release-test.ps1` for release testing rebuilds. It rebuilds the release test folder without ZIP packaging, stops running `AniListManagerPortable` processes, backs up and restores `release\AniListManagerPortable\.runtime` and `release\AniListManagerPortable\data`, regenerates embedded web assets, and updates the executable.
- `scripts\rebuild-release-test.ps1` retries `npm ci` once after stopping workspace frontend Node or esbuild processes if they lock `web\node_modules`.
- Preserve release `data\*` during release testing rebuilds.
- Use `scripts\build-release.ps1` directly only when a packaged ZIP release is requested.
- Check the native publish output before reporting completion. If `link.exe` is unavailable, `scripts\build-release.ps1` falls back from Native AOT to trimmed self-contained single-file publish; report that distinction.

## Release Versioning And Publishing

- Use the previous release tag as the comparison base for release notes. For the v1.1.0 release, `v1.0.0` pointed at commit `5a3e933`.
- Version bumps must update all version sources:
  - `web\package.json`
  - root and package entries in `web\package-lock.json`
  - `<Version>`, `<AssemblyVersion>`, and `<FileVersion>` in `native\AniListManagerPortable.csproj`
- The release ZIP name is derived from `web\package.json` by `scripts\build-release.ps1`, for example `AniListManagerPortable-1.1.0-win-x64.zip`.
- Before release packaging, clean completed checked TODO items from `TODO.md` only after their content has been captured in release notes or docs. Keep still-open TODOs.
- Validate on the release branch before merging:
  - Run `npm run build` from `web\`.
  - Run `scripts\rebuild-release-test.ps1`.
  - Smoke test `release\AniListManagerPortable\AniListManagerPortable.exe` on `http://127.0.0.1:6767/`; confirm `/api/update` reports the target version and `/api/readme` loads.
  - Confirm `release\AniListManagerPortable\AniListManagerPortable.exe` and `release\AniListManagerPortable\README.md` exist.
- Commit release-prep edits on the release branch, then merge into `main`. For a release merge, use a normal merge commit rather than rebasing away release branch history.
- Build the final packaged release from `main` with `scripts\build-release.ps1`.
- Confirm the final ZIP exists under `release\` and that the publish output was Native AOT unless a fallback warning explicitly says trimmed self-contained single-file was used.
- Tag `main` with an annotated release tag such as `v1.1.0`, then push `main` and the tag.
- Publish the GitHub release as a ready release, not draft, attach the generated ZIP, and include concise release notes covering user-visible changes, public API changes, and manual update instructions.
- If the GitHub connector does not expose release publishing tools, use GitHub's REST API with Git Credential Manager credentials from `git credential fill`. Keep credentials only in process variables and never print or commit them.
- After publishing, verify the release URL, `draft=false`, `prerelease=false`, and the uploaded ZIP asset name and size through the GitHub Releases API.
