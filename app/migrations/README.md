# D1 migrations

Applied in file-name order with `wrangler d1 migrations apply DB` (`--local` for
development, `--remote` for production). D1 records applied migrations by file
name, so never rename, renumber or edit a migration that has been applied;
add a new one instead.

## Shared tables

The database can be shared with other services that accept the same tap URLs.
Two tables are owned outside this app:

| Table | Purpose |
|-------|---------|
| `tap_counters` | One high-water mark per chip, so a tap URL is accepted at most once across every service. |
| `auth_challenges` | Short-lived challenges, partitioned by namespace. |

`revibase_0000_shared_tables_mirror.sql` mirrors their schema for local
development only (`IF NOT EXISTS`, a no-op against a shared database). Every
table this app owns is prefixed `revibase_` so its migration history cannot
clash with another service's.

## History

| Migration | Notes |
|-----------|-------|
| `0001`, `0004`, `0006`, `0007` | Link intents for the handoff flows; dropped in `0010`. |
| `0002` | Chip identifier cache. |
| `0003` | Deleted from the repository (`revibase_0003_mint_media`). `0005` drops its table on any database that applied it and is a no-op elsewhere. |
| `0008`, `0011` | Passkey wallet backups (removed); dropped in `0013`. |
| `0009` | Fee-sponsor ledger (removed); dropped in `0013`. |
| `0012` | Link intents again, for the restored in-app wallet and desktop handoffs (the columns of `0001`, `0004`, `0006` and `0007`). |
| `0013` | Drops the passkey wallet and fee-sponsor tables. |
