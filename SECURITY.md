# Security Policy

## Reporting a vulnerability

Please **do not** file a public GitHub issue for security problems. Instead, email **security@filarr.com** with:

- a description of the issue and its impact,
- the affected version(s) and platform(s),
- step-by-step reproduction (a minimal proof-of-concept is ideal),
- any logs or stack traces that helped you find it.

You can request a PGP key in your first message if you want the report encrypted.

We will acknowledge receipt within 5 business days, share an initial assessment within 10 business days, and keep you posted as we work on a fix. We aim to publish a patched release within 90 days of a confirmed report; truly critical issues are handled faster.

Coordinated disclosure is appreciated: please give us a reasonable window to ship the fix before publishing details.

## Scope

In scope:

- Vulnerabilities in this repository's code (renderer + Electron main process).
- Insecure defaults that put user data at risk on a freshly-installed copy.
- Cryptographic mistakes in the local vault encryption pipeline.
- Sandbox / IPC boundary issues that let untrusted content reach the main process.

Out of scope:

- Issues that require an attacker who already has unrestricted access to the user's OS account or disk.
- Findings that depend on dependencies being compiled or configured insecurely by a fork.
- Generic recommendations ("you should use library X instead") with no demonstrated impact.

## Threat model in one paragraph

Filarr stores everything encrypted at rest under a key derived from the user's vault password (Argon2id) and wrapped with the OS keychain via Electron `safeStorage`. The threat model assumes a trusted local OS account: an attacker with full filesystem and process access to the unlocked session is out of scope. A stolen device with the vault locked, or a backup of the user's profile directory, should not yield plaintext data.

## Supported versions

Only the latest release on the `main` branch receives security fixes.
