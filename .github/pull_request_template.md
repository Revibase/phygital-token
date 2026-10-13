## What and why

## How it was tested

## Checklist

- [ ] One concern per pull request; mechanical changes are separate from behavior changes
- [ ] Tests cover the change, including failure paths
- [ ] `pnpm build:program` was run and generated files are committed (program changes)
- [ ] `pnpm --filter phygital-token-sdk api:update` was run (SDK API changes)
- [ ] CHANGELOG updated for any published artifact that changed
