# ZCode Community

ZCode Community is a community distribution based on [ZCode](https://github.com/zai-org/ZCode), with desktop, Web and terminal AI coding interfaces. The current Community version is **0.1.7**, with its own application ID, package names and `community-v*` tags. It installs and updates separately from upstream 3.x releases.

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="ZCode" width="128" height="128" />
</div>
<p align="center">
  <a href="https://github.com/andrewliu83/ZCode/releases">Downloads</a> ·
  <a href="https://github.com/andrewliu83/ZCode/actions/workflows/community-release.yml">Builds</a> ·
  <a href="https://github.com/andrewliu83/ZCode/issues">Issues</a>
</p>
<p align="center">
  <a href="README.md">简体中文</a> | English
</p>

This repository contains the clients, backend services, shared UI, and Agent CLI and runtime source code.

## Community Features

- **Two agent kernels**: select ZCode or the bundled Claude Agent SDK in the chat composer. Switching kernels creates a new session and preserves unsent drafts and attachments. No separate Claude CLI installation is required.
- **ThinkRail**: enabled by default, with workflows, subagents and spec graph tools. Existing codebases with a confirmed empty spec graph enter project setup. An explicit disabled preference remains disabled.
- **System prompts per kernel**: edit the base prompt independently while viewing ThinkRail and other injected content as read-only sections.
- **Privacy cleanup**: ARMS reporting, business analytics, Agent OTLP telemetry and in-app feedback uploads have been removed. Local logs, diagnostic exports and model usage statistics remain. Model requests still send task context to the selected provider; plugins and MCP servers follow their own network configuration.
- **Independent updates**: all three desktop platforms use this repository's Community Releases rather than the upstream update service.

## Downloads and Installation

Choose a `community-v*` version from [GitHub Releases](https://github.com/andrewliu83/ZCode/releases). If no release is available yet, build locally or check [Actions](https://github.com/andrewliu83/ZCode/actions/workflows/community-release.yml) for artifacts from manual builds.

| System  | Architecture          | Packages                    |
| ------- | --------------------- | --------------------------- |
| macOS   | Apple Silicon / arm64 | `.dmg`, `.zip`              |
| Windows | x64                   | NSIS `.exe`                 |
| Linux   | x64                   | `.AppImage`, `.deb`, `.rpm` |

On macOS, open the DMG and move **ZCode Community.app** to Applications. Releases without Apple credentials use ad hoc signing and are not notarized. If macOS blocks the first launch, use Open Anyway in System Settings → Privacy & Security. Windows installers currently do not have Authenticode signing. Linux AppImages need executable permission; install DEB or RPM packages through the corresponding package manager.

Existing **ZCode Preview 3.x** users must install the first Community version manually. The app then checks for updates and prompts by default, preserves the automatic download preference, and verifies downloads before restarting to install. DEB/RPM updates may require system authorization. Community and upstream versions are compared separately; upstream 3.x releases are not Community updates.

## Upstream release history (reference)

- 2026-10-10: Updated to ZCode v3.15.1.
- 2026-9-23: Updated to ZCode v3.14.3.

## Setup

Install Git, Node.js **24.14.0**, and pnpm **10.33.2**. [mise.toml](mise.toml) is the source of truth for tool versions. Run all development and packaging commands below from the repository root.

```bash
pnpm bootstrap
```

`pnpm bootstrap` installs workspace dependencies, prepares local desktop runtime assets, and runs `build:bootstrap`.

The Agent CLI and runtime source code lives in [apps/zcode-cli/](apps/zcode-cli/) as a regular directory included when you clone this repository. No separate checkout or Git submodule initialization is required.

Additional setup and build commands:

| Command                        | Purpose                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                 | Install dependencies                                                                                                                |
| `pnpm prepare:desktop-runtime` | Prepare desktop runtime assets, including remote assets by default                                                                  |
| `pnpm prepare:remote-assets`   | Prepare remote runtime assets separately                                                                                            |
| `pnpm bootstrap:with-remote`   | Set up dependencies and local and remote assets, then build the relevant packages sequentially; skip the desktop application bundle |
| `pnpm build`                   | Recursively run each workspace package's build script, including its asset preparation steps                                        |

The default `bootstrap` skips remote asset preparation and is suitable for local desktop development. Run the corresponding preparation command when working with remote workspaces or validating remote distribution assets.

## Development and Usage

### Desktop

```bash
pnpm dev:desktop

# Use the test environment
pnpm dev:desktop:test
```

`pnpm dev:desktop` defaults to `pnpm dev:desktop:prod` and uses production service configuration. The startup script prepares local runtime assets, builds the desktop Agent, then starts Electron and source watchers.

Set `ZCODE_DATA_BASE_DIR` to use a separate development data directory. For example, on macOS / Linux:

```bash
ZCODE_DATA_BASE_DIR="$HOME/.zcode-dev-home" pnpm dev:desktop:test
```

### Web Development

Use development mode when editing Web or backend source code:

```bash
pnpm dev:web

# Set the backend workspace (macOS / Linux)
ZCODE_SERVER_WORKSPACE=/path/to/project pnpm dev:web
```

This starts both the Web development server (default: `http://localhost:5173`) and the backend (default: `http://localhost:3030`). Open the Web development server in your browser. `/ws` and general `/api` requests are proxied to the local backend; `/api/v1/oauth/token` is proxied separately to the configured product service.

After changing Agent source code, run `pnpm --filter @zcode/cli... build` and restart the service. To validate the complete distribution, extract and run it as described under Packaging → ZCode CLI distribution below.

### ZCode CLI distribution

The command-line distribution includes the TUI, Web client, and Agent behind one `zcode` command. With no arguments it starts the TUI; a leading `--web` starts Web mode; all other arguments go to the existing Agent CLI. Both modes run locally without Electron.

```bash
# Start the terminal UI by default
zcode

# Start the Web interface
zcode --web

# Set the project and port without opening a browser automatically
zcode --web --workspace /path/to/project --port 3030 --no-open

# Show CLI or Web options
zcode --help
zcode --web --help
```

In Web mode, it uses the current directory as the workspace, listens on `127.0.0.1` without token authentication by default, selects an available port, and opens a browser. Use the URL printed in the terminal and press `Ctrl+C` to stop the service. For LAN access, use `--host 0.0.0.0`; listening on a non-local address generates an access token by default. Use the token-bearing URL printed in the terminal. Set a token with `--token`, or disable token authentication with `--no-token`.

When starting the general Web service's HTTP entry directly, configure API/WebSocket authentication with `ZCODE_SERVER_AUTH_TOKEN`. When creating the service programmatically, use the `authToken` option.

See Packaging below for build instructions. `pnpm build:zcode` only creates the distribution; it does not replace an existing `zcode` on `PATH`. If the command still points to an older installation or another checkout, check it with `command -v zcode` on macOS / Linux or `where.exe zcode` on Windows.

### CLI Source Development

Use the source entry when developing the TUI or Agent:

```bash
pnpm --filter @zcode/cli dev --help
pnpm --filter @zcode/cli dev

# Build the CLI and its workspace dependencies
pnpm --filter @zcode/cli... build
node apps/zcode-cli/packages/cli/dist/zcode.cjs --help
```

This entry runs the Agent CLI directly and does not handle the distribution's `--web` switch. Use `pnpm dev:web` for Web development, or the extracted `bin/zcode.mjs` shown below to test the unified command.

### UI Plugin development

See the [UI Plugin guide](UI_PLUGIN.en.md) for the Excalidraw workflow, supported APIs, plugin installation and updates, and host debugging.

**Plugin PRs in `zcode-plugins` must declare whether they affect a UI Plugin and list the plugin names in the PR template.** See the [required plugin-type declaration](UI_PLUGIN.en.md#declare-the-plugin-type-in-pull-requests).

## Configuration

The root [.env.example](.env.example) provides sample service URLs and build configuration. Copy it to `.env` as needed and place local overrides in `.env.local`. Select the Desktop development environment with `dev:desktop:test` or `dev:desktop:prod`.

| Setting                              | Purpose                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `ZCODE_DATA_BASE_DIR`                | Base directory for application data, stored under its `.zcode/` subdirectory            |
| `ZCODE_SERVER_WORKSPACE`             | Workspace path for the Web backend                                                      |
| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` | Path to a local provider configuration file; uses the built-in configuration when unset |
| `ZCODE_DIST_BASE_URL`                | Download base URL used by the CLI distribution installer                                |

Runtime variables can be set explicitly in the environment of the startup command. See [config/README.md](config/README.md) for the default configuration shipped with the client.

## Packaging

See [third-party/README.md](third-party/README.md) for notice generation, distribution checks, and where the notices are included in each distribution.

### Desktop

Build the same Community packages used by GitHub Releases on each supported native host:

```bash
# macOS / Apple Silicon
pnpm release:desktop -- --os mac --arch arm64

# Windows x64
pnpm release:desktop -- --os win --arch x64

# Linux x64
pnpm release:desktop -- --os linux --arch x64

# Inspect a build plan without compiling
pnpm release:desktop -- --os win --arch x64 --plan
```

Outputs are written to `packages/desktop/dist/community/macos-arm64/`, `windows-x64/`, and `linux-x64/`, including installers, update manifests and SHA512 checksums. The build validates the host platform and architecture and checks that the packaged Agent starts.

The lower-level development packager remains `pnpm bundle:desktop`; use `pnpm bundle:desktop -- --help` for its options. Use `release:desktop` for the complete signing and verification flow.

### GitHub Releases

The [Community Desktop Release workflow](.github/workflows/community-release.yml) builds on native macOS, Windows and Linux runners. It publishes one release only after all three platforms succeed and their versions, commits and checksums are verified.

Commit and push the source, then create a tag matching the root `package.json` version and pointing to that commit:

```bash
git tag community-v0.1.7
git push origin community-v0.1.7
```

Rerunning Actions for an old tag still builds its original commit. Publish fixes with a new version and tag instead of moving an existing tag.

For subsequent releases, use `pnpm release patch` or `pnpm release minor` to update the version and push its release tag. Pushing `main` alone does not create a release; a manual Actions run only uploads build artifacts. Published versions cannot be overwritten; changes require a new version.

Without Apple credentials, macOS uses ad hoc signing. A complete set of Apple Secrets enables signing and notarization. See the [Community release guide](docs/desktop/community-github-release.md) for credentials, update installation boundaries and validation results. This workflow publishes desktop packages; terminal/Web distributions still use the separate packaging entry below.

### ZCode CLI distribution

Run `pnpm build:zcode` to build the CLI/TUI, backend, and Web client, collect the TUI native libraries, workers, and runtime dependencies, then assemble the distribution. Running the distribution still requires Node.js; use the version specified in `mise.toml`.

Before packaging, set the download base URL with `ZCODE_DIST_BASE_URL` in `.env`, `.env.local`, or the process environment, or pass it through `--base-url`. The URL below is a placeholder; replace it with your hosting URL when publishing:

```bash
pnpm build:zcode --base-url https://downloads.example.com/zcode/

# When ZCODE_DIST_BASE_URL is already configured
pnpm build:zcode

# Repackage existing Agent, backend, and Web build outputs
pnpm build:zcode --skip-build

# Show options for the version, output directory, and more
pnpm build:zcode --help
```

The version defaults to the root `package.json` version. Output is written to `dist/zcode/`:

- `releases/<version>/zcode-<version>.tar.gz`: runtime package.
- `releases/<version>/sha256.txt`: checksum file.
- `latest.json` and `install.sh`: version index and installer.

Upload the entire directory to the configured download base URL. The installer downloads the runtime package from that URL, installs it to `~/.zcode/runtime` by default, and creates the `zcode` command in `~/.local/bin`. Override these directories with `ZCODE_DIST_HOME` and `ZCODE_DIST_BIN_DIR`, respectively.

Existing Lite users should switch to the new build command, environment variables, and installer. Installation does not remove old Lite directories or migrate/delete session data.

To test a packaged build locally, extract and run it directly without uploading or installing it:

```bash
zcode_version=$(node -p "require('./dist/zcode/latest.json').version")
mkdir -p dist/zcode/debug
tar -xzf "dist/zcode/releases/$zcode_version/zcode-$zcode_version.tar.gz" \
  -C dist/zcode/debug
# Start the TUI by default
node dist/zcode/debug/zcode/bin/zcode.mjs

# Start Web mode
node dist/zcode/debug/zcode/bin/zcode.mjs --web \
  --workspace "$PWD" --port 3030 --no-open
```

Open `http://127.0.0.1:3030` to validate the complete flow, with one backend serving the Web pages and running the Agent. The port must be available; if `pnpm dev:web` is already running, choose another `--port`.

## Repository Structure

| Directory                                            | Responsibility                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/desktop`                                   | Electron Main, Host, Renderer, and desktop packaging                                    |
| `packages/web`                                       | Web client                                                                              |
| `packages/server`                                    | HTTP / WebSocket services and remote connections                                        |
| `packages/zcode-server-cli`                          | Standalone server startup and process management                                        |
| `packages/ui`                                        | Shared React components, hooks, and Zustand state                                       |
| `packages/services`                                  | Business services and persistence                                                       |
| `packages/shared`, `packages/rpc`, `packages/client` | Shared protocols and types, RPC framework, and Agent client SDK                         |
| `packages/provider`, `packages/provider-node`        | Common provider capabilities and Node implementations                                   |
| `apps/zcode-cli`                                     | Agent CLI, TUI, runtime, and tools                                                      |
| `scripts`, `config`, `third-party`                   | Build and maintenance scripts, built-in configuration, and third-party notice materials |

## Project Notice

See [NOTICE.md](NOTICE.md) for feature and promotion scope, maintenance policy, execution and data risks, licensing, and third-party copyright information.
