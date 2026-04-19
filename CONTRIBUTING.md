# Contributing to Filarr

Thanks for taking the time to look at this. A few things up front so we don't waste each other's time.

## Scope of this repository

This repo is the **public, source-available** desktop client. It is not the same codebase that powers any hosted Filarr product — cloud sync, accounts, billing, telemetry and infrastructure code are intentionally **not** included here and PRs that try to reintroduce them will be closed.

Contributions that are very welcome:

- Bug fixes (with a clear reproduction).
- Editor / UI / accessibility improvements.
- Translations and i18n fixes.
- Performance work backed by measurements.
- Documentation, type-safety improvements, code comments where the *why* is non-obvious.
- Security hardening for the local crypto path or the IPC boundary.

Contributions that will likely be declined:

- New cloud / network / sync features.
- Telemetry, analytics, crash reporting that phones home by default.
- Large refactors with no concrete user-facing benefit.
- Half-finished features behind a flag.
- Bundling new heavy runtime dependencies for a small gain.

If you're not sure whether something fits, open a **draft issue** describing the change before you start coding.

## Before you open a PR

1. **Open an issue first** for anything beyond a one-line fix, so we can agree on the approach.
2. Make sure your branch is up to date with `main`.
3. Run `npm run type-check`, `npm run type-check:electron`, and `npm run lint` locally — CI will fail otherwise.
4. Run `npm run format` so the diff stays clean.
5. Test the change with a real Electron build (`npm start`), not just the unit tests.
6. Keep the diff focused. One logical change per PR.

## Commit messages

Conventional commits are appreciated but not enforced. A clear sentence explaining **why** beats a perfectly-formatted prefix with no context.

## Code style

- TypeScript strict mode, no `any` unless you can justify it in a comment.
- Prefer editing existing files to creating new ones.
- No new dependencies without a quick rationale in the PR description.
- Don't add comments that just describe what the next line does. Reserve comments for non-obvious *why*.

## Localised strings

Anything user-facing must go through `react-i18next`. Add keys to both `src/i18n/locales/en/translation.json` and `src/i18n/locales/fr/translation.json`. Other locales are welcome too — open a separate PR per language if the diff is large.

## Tests

The project uses `react-app-rewired test` (Jest under the hood). Add a test when you fix a bug, especially if it touches encryption, file I/O, profile management, or note persistence.

## License

By submitting a PR you agree that your contribution is licensed under the same terms as the rest of the project (see [LICENSE](./LICENSE)).
