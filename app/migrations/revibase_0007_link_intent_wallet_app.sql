-- Which wallet app (e.g. "Phantom") finished the link, so the wallet picker can offer it first next time.
ALTER TABLE revibase_link_intents ADD COLUMN wallet_app TEXT;
