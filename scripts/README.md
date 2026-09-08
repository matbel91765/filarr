# Scripts — Filarr

Utility scripts for development and BYOS setup.

## Available Scripts

### setup-s3.sh — S3/BYOS Storage Setup

Automated S3 storage configuration for BYOS (Bring Your Own Storage) deployments.

```bash
# Interactive mode
./scripts/setup-s3.sh

# Direct provider selection
./scripts/setup-s3.sh --provider aws
./scripts/setup-s3.sh --provider minio
./scripts/setup-s3.sh --provider digitalocean
./scripts/setup-s3.sh --provider backblaze
./scripts/setup-s3.sh --provider wasabi
```

**Prerequisites:** AWS CLI (for aws), Docker (for minio)

### Other Scripts

| Script                          | Purpose                        |
| ------------------------------- | ------------------------------ |
| `release.js` / `release.sh`     | Build and publish releases     |
| `afterPack.js`                  | Electron post-build hooks      |
| `generate-placeholder-icons.js` | Generate placeholder app icons |
| `test-coverage.js`              | Run test coverage reports      |
| `run-qa-suite.sh`               | Run QA test suite              |
