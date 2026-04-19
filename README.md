# Filarr

Privacy-first local file & note vault. Encrypted, offline, cross-platform.

Filarr is a desktop application for organising files and notes inside a single encrypted vault that lives entirely on your machine. There is no account to create, no server to trust, no telemetry sent anywhere. Open the app, set a vault password, and your data stays on your disk.

## Status

This repository is the public, source-available release of the Filarr desktop client. It contains only the renderer (React) and the Electron main process — the cloud sync, billing and account components that powered the hosted product have been removed for this release. See [CONTRIBUTING.md](./CONTRIBUTING.md) for details on the scope of contributions accepted.

## Features

- Local-first folder & file organisation, with colours, tags, favourites and a trash
- Rich Markdown notes with tables, code blocks, math (KaTeX), Mermaid diagrams and a graph view of links between notes
- Wiki-style internal links between notes, autolinked URLs, bookmark previews
- Built-in password manager (logins, secure notes, credit cards, identities)
- Versioned note history, encrypted on disk
- Vault export / import (encrypted ZIP)
- File preview for PDFs, images, code, archives and many more
- Customisable themes, multiple panels, keyboard shortcuts, command palette
- Internationalisation (English, French)
- Per-profile data isolation, optional PIN lock, automatic lock after inactivity

Everything is stored encrypted on disk under your vault password using AES-256-GCM with an Argon2id-derived key.

## Tech stack

- **Electron** + **TypeScript** for the desktop shell
- **React 18**, **Redux Toolkit**, **Redux Persist** for the renderer
- **Tiptap**, **Yjs**, **Lowlight**, **KaTeX**, **Mermaid** for the editor
- **Argon2** for password-based key derivation, Electron `safeStorage` for OS-level secret storage
- **Tailwind CSS** for styling
- **Webpack 5** + `react-app-rewired` for the build

## Getting started

Requirements: Node.js 20 or later, npm 10 or later.

```bash
git clone https://github.com/<your-fork>/filarr.git
cd filarr
npm install --legacy-peer-deps
npm start
```

`npm start` runs the dev server and the Electron shell together. The first launch walks you through creating a profile and setting a vault password.

## Building installers

```bash
npm run package:win     # Windows NSIS installer
npm run package:mac     # macOS DMG (requires macOS host for signing)
npm run package:linux   # AppImage + .deb
```

Output binaries land in `dist/`.

## Project layout

```
src/                   React renderer (UI, Redux store, services, hooks)
src/services/auth/     Local cryptography (Argon2, AES-GCM, FEK wrapping)
electron/              Electron main process (IPC, file I/O, encryption bridge)
public/                Static assets shipped with the renderer
buildResources/        Icons & entitlements for electron-builder
```

## Security

If you discover a vulnerability, please follow the process in [SECURITY.md](./SECURITY.md). Do not file a public issue.

## Contributing

Bug reports, fixes and small focused features are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request, and abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

Source-available under the **Business Source License 1.1** — see [LICENSE](./LICENSE) for the full text and the change date.
