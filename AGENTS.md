# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository. **Keep this file and `README.md` up to date with every change that affects them.** See [Maintenance rules](#maintenance-rules).

## What this project is

`dsh-sbx-client` is an Electron app that displays the web UI of a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) host running elsewhere (typically in a Docker Sandbox). It starts no DSH host itself. It is a plain shell around a URL plus convenience actions.

- DSH's own desktop app (`apps/desktop` in the DSH repo) always starts a local host and has no documented option to attach to a remote one. That is why this app exists. It is a reference for patterns only, not a base to fork.
- DSH APIs are **pre-stable**. Check the current DSH docs (`docs/user/guide/public-deployments.md`, `apps/desktop/README.md`) instead of relying on memory.

## Repository rules

- **Language:** all code, comments, identifiers, file and folder names, commit messages, README and AGENTS.md are in **English**.
- **No machine-specific content:** no personal paths, drive letters, user names, host names, ports or sandbox names that only exist on one person's system, in code, docs, tests or examples. Use neutral examples (`http://127.0.0.1:3080/` is the default address of `dsh web`).
- **No secrets:** never commit tokens, API keys or session data. The launch token is never persisted.
- **Defaults must be explicit and generic.** The only suggested address is `DEFAULT_URL` in `src/shared/ipc.ts`; the last successful address overrides it.
- **Agents commit and push only when asked.** Files end with exactly one newline.

## Stack

- Electron 45, TypeScript 6 (strict), electron-vite 6 with Vite 6, plain HTML/CSS/TS renderer (no UI framework).
- Package manager: **pnpm 11** (pinned via `packageManager`). pnpm 11 blocks install scripts; `pnpm-workspace.yaml` lists `electron` and `esbuild` under `allowBuilds`. If the Electron binary is missing after install, run `pnpm rebuild electron`.
- The package is **CommonJS on purpose** (no `"type": "module"`): sandboxed preload scripts cannot be ES modules. Source files still use ES module syntax; electron-vite emits CJS.

## Layout

```
src/
  main/          Main process
    index.ts       App lifecycle, single-instance lock
    window.ts      BaseWindow with two views, layout, remote session + permission policy
    connection.ts  ConnectionManager: connect/disconnect state machine, navigation guards
    target-url.ts  Parse and normalize user input (http/https only, token stripped for storage)
    settings.ts    Settings store: settings.json in userData (cached, atomic write)
    sbx.ts         runSbx(): the only place that spawns the sbx CLI (execFile, no shell)
    address.ts     Pure helpers without Electron/Node imports: auto-reconnect address, token extraction,
                   `{port}` placeholder, login URL (unit-testable on their own)
    listing.ts     Pure parser for `find -printf` directory listings (NUL-separated records)
    files.ts       listDirectory(): runs the listing command through `sbx exec`
    explorer-ipc.ts  Files dialog: list, copy to host, opening it for a sandbox
    logger.ts      The app's own log: file with rotation, levels, `log.info(scope, message)`, `logWebContents`,
                   `untrustedSender()`; never throws. `log-dir.ts` (pure) chooses the folder.
    confirm.ts     The shared native confirmations: "Replace existing items?" and "Delete items?"
    upload.ts      runUpload(): native picker, replace check, copy, chown; shared by Copy files and the browser
    logs-ipc.ts    Logs dialog: find, open, poll (follow), list for the picker, save; `LogsOpener` lets the
                   Files dialog open a file and the Application menu open the app log
    log-reader.ts  Reading for the viewer from two targets (a file in a sandbox via `sbx exec`, or a file of the
                   app's own log folder) with one shared chunking, plus the cursor state and the finders
    templates.ts   `sbx template` calls (ls, save, load, rm); templates-ipc.ts: the Templates dialog handlers and the
                   native confirmations
    mounts.ts      Pure parser for the `mounts` entries of `sbx ls` (`HOST:SANDBOX[:ro]`)
    sandboxes.ts   `sbx ls --format json` parsing, start/stop, running the login command
    transfer.ts    `sbx cp` and the helper commands around it (home, existence check, ownership)
    transfer-ipc.ts  Copy files dialog: native pickers, replace confirmation, orchestration
    dialogs.ts     DialogHost: every dialog (Sandboxes, Settings, Copy files, Files, Logs, Templates) as an in-app view,
                   one at a time
    ipc.ts         All IPC handlers; each group accepts only its own view as sender
    menu.ts        Application menu; zoom/reload/devtools act on the remote view
  preload/       One contextBridge API per view: index.ts (toolbar), sandbox.ts, settings.ts, transfer.ts,
                 explorer.ts, logs.ts, templates.ts
  renderer/      file-browser.ts (reusable explorer component: tree, list, address bar; it only renders what its
                 `list` callback returns), context-menu.ts (in-page menu), file-browser.css
                 file-picker.ts (the "Browse…" picker layer, shared by Copy files and Logs; the page provides the
                 `#picker` markup), logs.ts/logs.html/logs.css (log viewer)
                 One HTML page per view: index (toolbar + status panel), sandbox, settings, transfer, explorer, logs,
                 templates (templates.ts/templates.html);
                 theme.css (tokens, buttons, inputs), styles.css (main), window.css (dialogs),
                 dialog-common.ts (close button and Escape)
  shared/        Types, constants and IPC channel names: ipc.ts, sandbox.ts, settings.ts, dialog.ts,
                 transfer.ts, explorer.ts; sandbox-path.ts (pure POSIX path helpers used by main and renderer:
                 `~` expansion, join, base name, parent, breadcrumb segments); protect.ts (pure safety rules for
                 delete/rename and entry-name validation); logging.ts (pure: levels, `maskSecrets`, line format,
                   rotation steps, file-name check; shared by the logger and the log viewer);
                 templates.ts (contract of the Templates dialog and pure helpers: `ls --json` parser, name and id validation);
                 logs.ts (contract of the Logs dialog); log-view.ts (pure: limits, ANSI/control cleaning,
                   size header and newline splitting of raw bytes, finder output parser)
tests/           Unit tests of the pure modules (`*.test.mts`, run with `pnpm test`)
build/           App icon: icon.svg (source) and icon.png (generated, committed)
scripts/         build-icons.mjs (SVG to PNG with sharp), after-pack.cjs (install manifest), run-tests.mjs
electron-builder.yml   Packaging config (NSIS installer + portable exe, output in release/)
```

Installer files: `build/installer.nsh` (custom NSIS hooks, picked up automatically) and `scripts/after-pack.cjs` (writes `install-manifest.txt` into the app folder at build time).

## Architecture and invariants

- **Two views in one `BaseWindow`:** the local *chrome* view (toolbar and status panel, has the preload) and the *remote* view (DSH UI). While not connected the chrome view fills the whole window and covers the remote view (it is moved on top, not hidden); when connected the chrome view is only the toolbar strip.
- **The remote view must never get a preload script or any IPC access.** It shows untrusted content (agent output, web pages). Anything powerful (`sbx` commands, file transfer) is reachable only from the chrome view via IPC, and `ipc.ts` verifies the sender.
- **Remote session:** dedicated persistent partition `persist:remote` keeps the DSH session cookie (valid up to 30 days, bound to scheme, host and port, so use the same address each time). "Sign out" clears this partition.
- **Navigation fence:** the remote view may only show the connected origin (and `about:blank`). Other URLs open in the system browser, and only for `http`/`https`.
- **Stale results:** every connect/disconnect increments `attempt`; async results of older attempts are discarded.
- **Never log or store the launch token.** `parseTargetUrl` strips `token` from the address that is saved.
- **Start/stop rules:** `sbx run --name X --detach` would *create* a sandbox for an unknown name, so the main process lists first and only starts existing, stopped sandboxes (stop: existing, running ones). Start reconnects through `ConnectionManager.connect(url, { waitForHostMs })`, which keeps probing because the sandbox is up before the web UI inside it is. Reconnect only happens when `lastUrl` is one of the started sandbox's published loopback ports (`pickAutoConnectUrl`). While connecting, the toolbar button is "Cancel".
- **Login command (`tokenCommand`):** runs inside the sandbox via `sbx exec <name> sh -c <command>` (not on the host), only for a running sandbox whose published port was verified. Only the token is taken from the output (`extractToken`, last match, `[A-Za-z0-9_-]`); the address is always rebuilt with `buildLoginUrl(hostPort, token)`, so output can never redirect the app. The token must never be logged, stored (`lastUrl` is stored without it) or shown: `runSbx` masks `token=…` in error text. Empty command = feature off.
- **File browser rules:** directories are listed with `sbx exec <name> sh -c 'find -H "$1" -mindepth 1 -maxdepth 1 -printf …' sh <path>` (path as an argument, never spliced into the script; NUL-separated records so odd names survive; one call takes about 0.6 s regardless of folder size, so folders load on demand and are cached per browser until refresh). The renderer only sends absolute paths or `~`; the main process validates them again (`validateSandboxPath`), refuses the file system root for copying, and opens the host-side target in a native picker itself. Browsing re-checks that the sandbox runs at most every 10 s (`sbx exec` would silently start a stopped sandbox); operations that change things must check fresh.
- **Logging (do not weaken):** `initLogger()` runs only in the primary instance (after the single-instance lock). Every line goes through `formatLogLine`, which masks `token=…` and flattens line breaks, so a launch token can never be written. Never log the output of an `sbx` call (it may hold a token); `runSbx` logs only the call (arguments cut to 100 characters) and its duration at `debug`, failures at `warn`. Do not log setting values that may be secret (the login command): log the names of changed settings only. Use `log.info` for what the user did, `log.warn` for refusals and recoverable problems, `log.error` for failures, `log.debug` for detail. The log folder is chosen by `chooseLogDir`: next to the exe (installed), `PORTABLE_EXECUTABLE_DIR` (portable build), the project folder (development), else `app.getPath('logs')`. `build/installer.nsh` removes `$INSTDIR\logs` on uninstall (the folder is not in the install manifest). The `maskTokens` setting is for the log viewer only; the app's own log is always masked. The viewer's own log lines (`log.info('logs', …)`) name the file and size, never its content.
- **Log viewer (do not weaken):** read-only. The Logs dialog names a file path and a line count (`isValidLineCount`: 200/500/1000/5000); the main process validates the path (`validateSandboxPath`), re-checks that the sandbox runs, and passes path and numbers to fixed `sh -c` scripts as arguments (`log-reader.ts`), never spliced into the script. **No `tail -f` and no long-running process**: killing the local `sbx exec` would leave the remote process behind. Following is a poll every 2 s that reads only the bytes between the last offset and the current size (`tail -c +N | head -c n`, at most 1 MB per step); the script prints the size first so the offset is exact, and `sbx exec` output is taken as raw bytes (`runSbxBytes`) so a multi-byte character or a `token=…` split between two reads is joined again before it is decoded and masked. The cursor (offset plus the bytes of the unfinished last line) lives in the main process (`logs-ipc.ts`); a new `open` replaces it, so a poll that started before is dropped. A size smaller than the offset means rotation: the file is loaded again from its end (`reset`). Binary content (a NUL byte) is refused. Masking follows `maskTokens` at the moment of reading, and view, filter, copy and save all use the masked lines. "Save to host…" takes the text of the view from the page (at most `MAX_SAVE_CHARS`), but the file name is only a suggestion (reduced to a plain name) and the target is always chosen in a native dialog opened by the main process. The list of logs is a `find -H <roots> -maxdepth 5 … -name '*.log' -printf` with roots chosen by the main process (home, shared folders, `/var/log`, `/tmp`); nothing DSH-specific is hard-wired. **The app's own log** is a second target (`LogTarget` kind `app`) read from the host with the same chunking: the page names only one of the app's log files by plain name (`isLogFileName`, checked again in `appFile`), the folder is always `getLogDirectory()`, so no host path ever comes from the page; it is never masked again because every line was masked when written, and the dialog is opened without a sandbox from the Application menu entry (`AppMenus.onApplicationLog`). **There is no switch between the two kinds of log:** how the dialog was opened decides (`initialSource`), the main process refuses the other kind (`source !== initialSource`), the app-log dialog hides the sandbox controls (title "Application log", no way back to the Sandboxes dialog, no Browse), and opening a log dialog always closes an open one first (`DialogHost.open` only focuses a dialog with the same key, which would keep the old page). The viewer does not poll while its page is hidden. "View as log" in the Files dialog goes through `EXPLORER_IPC.viewAsLog`, where the main process takes the sandbox from its own state and validates the path.
- **Templates (do not weaken):** local `sbx template` only (no `--cloud`). The dialog is opened for one sandbox (`SANDBOX_IPC.openTemplates`); the renderer sends only a template name (`validateTemplateTag`: image-name rules, never starts with `-`, so it cannot be read as an option) or a template id (`isValidTemplateId`: lowercase hex). Removing re-lists and acts only on an id the runtime reports now, asks in a native dialog ("Cancel" default) and passes the id, not the name. It passes `--force` because `sbx template rm` otherwise asks on its own and fails without a terminal ("stdin is not a terminal"): the app's own dialog is the confirmation. The file for an export (`--output`) and the tar file for a load are chosen in native dialogs opened by the main process, absolute paths only. Saving a running sandbox needs an extra native confirmation (the docs suggest stopping first; what happens to a running sandbox is not documented). Save, load and delete are heavy and run one at a time (`exclusive`), with a 30 minute limit. The delete confirmation warns that `sbx template save` needs the image a sandbox was created from to still exist.
- **Browse… picker:** `file-picker.ts` wraps `FileBrowser` as a layer over a dialog (`#picker` markup in `transfer.html` and `logs.html`, `position: absolute` inside the dialog). It uses `selectable: 'directories'` for the destination (files dimmed; with nothing selected "Select" takes the open folder) or `'any'` for the download source (needs a selection), always with `multiple: false`. The picker only gets read-only listing (`TRANSFER_IPC.list`, same command and limit as the browser); it changes nothing. Escape closes only the picker (the layer stops the event before `setupDialogClose` sees it). `FileBrowser.navigate()` returns whether the folder was shown, which is how an invalid start path falls back to the home folder.
- **Changing files (do not weaken):** the main process is the authority; every change re-checks that the sandbox runs (fresh, not the browse cache), re-validates paths and names, and applies `protectedReason` (`src/shared/protect.ts`): never delete or rename `/`, any direct child of `/`, the home folder or its parents, a shared folder or anything that contains one, or a path with `.`/`..` segments. Deleting asks in a native dialog with "Cancel" as the default and adds a warning when the items lie inside a shared folder (they are real files on the user's computer); `rm` runs with `-r --one-file-system --` (no `-f`) so it never crosses into another file system. Rename refuses to replace an existing item (explicit `-e`/`-L` check, not `mv -n`); new names go through `validateEntryName` (no `/`, no `.`/`..`, no control characters, at most 255 bytes). Folders are created with `mkdir` (no `-p`) as the regular sandbox user.
- **Shared folders ("Open"):** the renderer sends a sandbox name and a host path; the main process re-lists sandboxes and only acts on a path that equals one of that sandbox's mounts (exact string match). `shell.openPath` is used for directories only; a mounted single file is revealed with `showItemInFolder`, because `openPath` would run it. In `parseMount` the LAST `:/` separates the Windows host path (which has its own colon) from the sandbox path.
- **Copy files rules:** paths on this computer never come from a renderer; they come from native pickers opened in the main process (`dialog.showOpenDialog`), and `copyToSandbox`/`copyFromSandbox` require absolute paths. Only the sandbox-side path is typed by the user (`validateSandboxPath`: absolute or `~/`, no control characters). Observed `sbx cp` behavior that the code relies on: it replaces existing items silently (so the app looks first with `findExistingInSandbox` and asks, the paths are passed to `sh -c '… "$@"'` as separate arguments), a folder lands inside the destination under its own name, a missing destination folder is an error, a stopped sandbox is started by `cp` (so `requireRunningSandbox` runs first), and **everything it creates in the sandbox is owned by root** (so `giveToSandboxUser` runs `chown -R -h <uid>:<gid> -- <path>` through `sbx exec -u root`, best effort).
- **Anything that runs `sbx` (list, start/stop, `sbx cp`, ...):** implement in the main process via `runSbx()` in `src/main/sbx.ts` with a fixed argument list. Never use a shell and never pass renderer strings through unchecked: sandbox names are validated with `isValidSandboxName`, ports with `isValidPort` (`src/shared/sandbox.ts`).
- **The renderer names things, the main process decides.** For example the Sandboxes dialog sends only a sandbox name and a host port; the main process re-lists sandboxes, checks the port belongs to that running sandbox, and builds the address itself.
- **Custom title bar.** `BaseWindow` uses `titleBarStyle: 'hidden'` with `titleBarOverlay`, so Windows draws the minimize/maximize/close buttons over the top-right corner and the local view draws the rest (`.titlebar` in `styles.css`, 36 px, `-webkit-app-region: drag`, menu buttons `no-drag`, 140 px kept free on the right). The overlay colors in `window.ts` (`TITLEBAR_COLORS`) must match `--bg-titlebar` and `--fg` in `theme.css`; heights must match `TITLEBAR_HEIGHT`/`TOOLBAR_HEIGHT` in `window.ts`. The title bar buttons "Application" and "View" send their bottom-left position to the main process (`IPC.openMenu`), which opens the native popup from `AppMenus` (`menu.ts`). The same definitions are also installed as the hidden application menu so accelerators such as F5 keep working, and the native menu bar stays hidden (`setMenuBarVisibility(false)`). Do not give zoom items accelerators: the DSH web UI uses them.
- **Dialogs are views inside the main window, not windows.** `DialogHost` (`src/main/dialogs.ts`) adds one `WebContentsView` sized to its card, centered over the content and kept on top (it re-raises itself after every layout pass via `AppWindow.onLayout`). This keeps dialogs on the monitor of the main window and out of the taskbar. They are deliberately **not** full-window overlays: native views do not blend, so a transparent layer shows the window background instead of dimming the page below. Consequently dialogs are non-modal and close with the X button or Escape.
- **One page and one preload per view**, each exposing only its own API (`sbxClient`, `sandboxApi`, `settingsApi`, `transferApi`, `explorerApi`, `logsApi`, `templatesApi`). Handlers check the sender (`assertFromChrome`, `DialogHost.isTrusted`). Add a dialog by: spec in `dialogs.ts`, entries in `electron.vite.config.ts` (preload and renderer input), a `shared/<name>.ts` contract, a preload (include `close`), a page using `setupDialogClose`, and a handler group in `ipc.ts`.
- **Preload bundles must stay self-contained.** Sandboxed preloads cannot `require()` other local files, so `electron.vite.config.ts` sets `isolatedEntries: true`. Without it, code shared by two preloads moves into `out/preload/chunks/` and the preload silently fails to load (`window.<api>` is `undefined`). After changing preloads check that `out/preload/*.js` contain no `require("./`.
- Errors from `sbx` are shown to the user as returned result objects (`{ ok: false, message }`), not as thrown IPC errors.

## Commands

```sh
pnpm install
pnpm dev          # electron-vite dev (hot reload)
pnpm typecheck    # tsc for node (main/preload/shared) and web (renderer/shared) projects
pnpm test         # unit tests of the pure modules (Node's built-in TypeScript support)
pnpm build        # production build to out/
pnpm start        # run the production build
pnpm dist         # installer + portable exe into release/ (git-ignored)
pnpm dist:dir     # unpacked app only, quickest packaging check
pnpm icons        # regenerate build/icon.png after editing build/icon.svg
```

Packaging notes:

- The icon is an **original** drawing. Do not copy the DeepSeek or Docker logos: they are trademarks and the app is an unofficial community project.
- electron-builder derives the `.ico` from `build/icon.png` (1024x1024). Keep the PNG committed so builds do not depend on `sharp`.
- `pnpm-workspace.yaml` sets `electron-winstaller: false` in `allowBuilds` (Squirrel is not used) so installs stay free of the "ignored build scripts" error.
- The builds are unsigned. Signing needs a certificate and is not configured.
- **Install folder rule (do not weaken):** electron-builder's default `instFilesPre` always appends `\<app name>` to the chosen folder because its uninstaller runs `RMDir /r $INSTDIR`. We replace it in `build/installer.nsh` (`customPageAfterChangeDir` redefines `MUI_PAGE_CUSTOMFUNCTION_PRE`; `customInit` applies the same rule to silent installs) so an empty/new folder or an existing install is used exactly as chosen, and a non-empty foreign folder gets the subfolder after confirmation. This is only safe because `customRemoveFiles` deletes just the entries in `install-manifest.txt` and then does a non-recursive `RMDir`. Never reintroduce `RMDir /r $INSTDIR` there.
- electron-builder compiles NSIS with warnings as errors. The original `instFilesPre` is referenced from unreachable code in `installer.nsh` for that reason.
- Test the installer silently into throwaway folders: `setup.exe /S /D=<folder>` (`/D` must be the last argument, no quotes), and the uninstaller with `/S`. It relaunches itself from `%TEMP%`, so wait until the files are gone. Check beforehand that no real install exists (same app id, same registry key).
- The packaged app ships only `out/**` and `package.json`; there are no runtime dependencies.

Run `pnpm typecheck`, `pnpm test` and `pnpm build` before reporting work as done.

## Testing

**Unit tests** (`pnpm test`, files in `tests/`) cover the pure modules, which have no Electron or Node imports on purpose so they can be loaded by Node directly: address and token helpers, URL parsing, mounts, directory listing, sandbox paths, protection rules and entry names, logging helpers and the log folder choice, the log viewer helpers, and the template helpers. Keep new logic that can be pure in such a module (relative imports in them need the `.ts` extension), and add cases next to it.

**Everything that needs Electron or `sbx`** was checked by running the built app and driving it through the DevTools protocol, partly with real native dialogs and visual checks: connect and sign-out against a dummy HTTP host, the Sandboxes, Settings, Copy files, Files, Logs and Templates dialogs against the real `sbx` CLI, the custom title bar and menus, the app log (levels, rotation, fallback folder), the installer (silent install and uninstall into throwaway folders). Not covered: a real DSH host over a long session (WebSockets), a host behind a trusted-host or reverse-proxy setup, the interactive pages of the installer, crash entries from a really crashed renderer, the light theme, snapping and maximizing with the title bar overlay, loading a template from a tar file, uploading a folder, downloading from the sandbox, and a few edge cases noted in the code comments.

How to try the app without touching your own settings: start it with a throwaway profile and a debugging port, for example `electron . --user-data-dir=<temp folder> --remote-debugging-port=9333`, then inspect and drive the windows over the DevTools protocol (`http://127.0.0.1:9333/json`).

Rules for tests that touch real things:

- **Never run `pkill`, `rm` or similar inside a sandbox, and never stop processes that are not your own test processes** (identify the test instance by its command line). Do not start, stop or change sandboxes in tests unless it is a throwaway one or its owner agreed; read-only checks (list, browse, read logs) are fine.
- Test sandbox features against a sandbox that really runs what the feature is about. A sandbox without DSH proves nothing about the log viewer or the login command.
- Launch tokens are credentials: never print a start-up log of DSH unmasked in test output.
- A real silent install and uninstall is fine, but check the registry first: if the app is installed, a test installer replaces that installation.
- Antivirus products may flag small compiled helpers (for example `Add-Type` wrappers around `user32`) that drive a window with real input. Keep such helpers in a folder that is git-ignored and exempt from scanning, let them act only on the test instance, and make them refuse to send input or take screenshots unless a window of the test process is in the foreground (otherwise another window ends up in the picture).
- In Git Bash set `MSYS_NO_PATHCONV=1` when passing sandbox paths like `/tmp/x` to `sbx.exe`, otherwise they are rewritten to Windows paths.
- `sbx` is built for scripts and may behave differently without a terminal. Read `sbx <command> --help` before using a command that changes something (for example `sbx template rm` needs `--force` there).

Lessons learned (keep in mind when changing `window.ts` / `settings.ts`):

- **Never hide the remote view** (`setVisible(false)`): Chromium then never reports the load as finished and `loadURL` hangs. Cover it with the chrome view instead.
- `fs.rename` can fail with `EXDEV` on redirected profile folders, so `saveSettings` falls back to an in-place write, and a failed save must never break a connection.

## Out of scope

- Cloud sandboxes (`sbx --cloud ...`): everything here is local.
- Drag and drop from the system file explorer into the file browser: it would let file paths come from the page, which the design forbids (paths on this computer only come from native dialogs).

## Maintenance rules

- Any change to features, commands, settings, layout or invariants **must** update `README.md` and this file in the same change.
- New settings keys go into the README settings table and `src/main/settings.ts`.
- New IPC channels go into `src/shared/ipc.ts` first (names and types), then main, preload and renderer.
- This file and the README describe the current state only. Do not add progress logs, to-do lists or notes about who tested what.
