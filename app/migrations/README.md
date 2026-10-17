# D1 migrations

Applied in file-name order with `wrangler d1 migrations apply DB` (`--local` for development, `--remote` for production). D1 records applied migrations by file name, so never rename, renumber, or edit a migration that has been applied. Add a new one.

The database can be shared with other services that accept the same tap URLs. `tap_counters` and `auth_challenges` are owned outside this app: one tap-counter high-water mark per chip, and short-lived challenges partitioned by namespace. `revibase_0000_shared_tables_mirror.sql` mirrors them for local development (`IF NOT EXISTS`). Every table this app owns is prefixed `revibase_`.

This app's table is `revibase_identifier_cache`. Earlier migrations created link-intent, passkey-wallet, and fee-sponsor tables. Later migrations drop them. Claims are built and submitted in the browser.
