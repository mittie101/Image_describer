# Image Description Generator

AI-powered desktop app for generating image descriptions and Midjourney prompts. Supports OpenAI, Anthropic, and Google Gemini.

## Requirements

- Node.js 20+
- Windows 10/11 (primary target; macOS/Linux may work with minor changes)

## Quick Start

```bash
npm install
npm start
```

## Scripts

| Command | Description |
|---|---|
| `npm start` | Launch the app |
| `npm run build` | Build Windows installer |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run lint` | Check for lint errors |
| `npm run lint:fix` | Auto-fix lint errors |
| `npm run format` | Format source files with Prettier |

## Architecture

```
main.js              Electron main process — window, IPC handlers, API calls, store
preload.js           contextBridge — exposes typed IPC API to renderer (no nodeIntegration)
src/
  app.js             Renderer — UI logic, state, event handlers
  index.html         App shell HTML
  styles.css         Styles
  logger.js          Structured JSON logger (main process)
  migrateStore.js    Electron-store schema migrations
  validators.js      Input validation for all IPC channels
tests/
  __mocks__/         Jest stubs for electron, electron-store, electron-updater
  *.test.js          Unit + integration tests
.github/workflows/
  ci.yml             GitHub Actions — lint, test, coverage, build
```

## IPC Channels

All channels are defined in `preload.js` and handled in `main.js`. Input is validated in `validators.js` before processing.

| Channel | Direction | Description |
|---|---|---|
| `generate-description` | R→M | Generate image description via AI |
| `get-settings` / `save-settings` | R↔M | Read/write app settings |
| `get-history` / `save-history-item` / `delete-history-item` / `clear-history` | R↔M | History CRUD |
| `get-history-image` | R→M | Load history thumbnail from disk |
| `set-api-key-for-provider` / `delete-api-key-for-provider` / `get-provider-status` | R↔M | Per-provider API key management |
| `has-api-key` / `set-api-key` / `delete-api-key` / `get-api-provider` | R↔M | Legacy single-key API (still supported) |
| `test-api-key` | R→M | Validate an API key against its provider |
| `get-available-models` | R→M | List models for configured providers |
| `update-stats` / `get-stats` | R↔M | Usage statistics |
| `get-templates` / `save-template` / `delete-template` | R↔M | Prompt template CRUD |
| `save-batch-queue` / `get-batch-queue` / `clear-batch-queue` | R↔M | Batch queue persistence |
| `export-text` / `export-json` / `export-csv` / `export-markdown` | R→M | Export descriptions |
| `get-diagnostics` / `export-diagnostics` | R→M | System diagnostics |
| `cancel-request` | R→M | Abort an in-flight AI request |
| `open-external` / `show-message-box` | R→M | Shell utilities |
| `load-main-app` / `load-setup` | R→M | Navigate between setup and main UI |
| `update-available` / `update-downloaded` / `update-error` | M→R | Auto-updater events |
| `install-update` | R→M | Trigger update install |

## Store Schema Migrations

Managed by `src/migrateStore.js`. Current version: **4**.

| Version | Change |
|---|---|
| v1 | Initial schema |
| v2 | Added `settings.defaultModel` |
| v3 | Added `settings.showOnboarding`, `settings.concurrency` |
| v4 | Added `stats.byProvider` (per-provider usage breakdown) |

A full backup of the previous store is saved to `schemaBackup` before any migration runs. Legacy single-provider API key migration is handled at runtime in `main.js` via `safeStorage`.

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `enableRemoteModule: false`
- Strict Content Security Policy on all responses
- All IPC inputs validated via `validators.js` before processing
- API keys encrypted with OS-level `safeStorage` (not stored in plain text)
- IPC rate limiting on expensive channels

## Logging

Main process logs to `%APPDATA%\image-description-generator\app.log` in JSON format:

```json
{"ts":"2025-01-01T12:00:00.000Z","level":"INFO","ctx":"main","msg":"Schema migrated","meta":{"from":3,"to":4}}
```

Log file is appended on each run and is not auto-rotated.
