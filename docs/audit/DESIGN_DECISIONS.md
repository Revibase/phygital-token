# Design decisions and accepted risks

Choices that can look like findings but are deliberate. Each says what was
decided, why, and what it costs.

## Program

**Trusted roles.** The admin can close any token; re-initializing the same
passkey restores the same token address with a type and owner the issuer
chooses. The minter
can rewrite a token's `mint`, which the program never relies on. The upgrade
authority can change everything. These roles are operated by the issuer of the
accessories. See [program threat model](../program/THREAT_MODEL.md#trusted-roles).

**`create_config` is first-caller-wins.** Mitigated by the deploy procedure in
[BUILD.md](BUILD.md#deploying) rather than in code; a front-run is recoverable by
the upgrade authority.

**Optional rpId and origin checks.** `verify` checks them only when the caller
asks, and `set_owner` checks neither. A credential's key is scoped to one rpId
on standard authenticators, and the challenge plus sign count bind the action.
The app checks both off-chain before it stores a tap; a native client writes its
own `clientDataJSON` anyway.

**The `set_owner` challenge does not name the recipient.** It is
`SHA256("transfer" ‖ token ‖ slot_hash)`, so a phone can tap before the wallet
that finishes the claim is chosen: in a wallet app's browser (in-app handoff)
or on a computer (desktop pairing). Anyone who sees the assertion before it
lands can submit it with themselves as recipient and take a Bearer or unowned
Controlled token. Accepted for the handoff flows; the assertion is single-use,
expires with its slot hash, and the app keeps it only on the link intent that
the claiming finisher can read.

**`clientDataJSON` is scanned, not parsed.** The first `"type"`, `"challenge"`
and `"origin"` keys are taken as the fields, which is what browsers serialize
first. A crafted `clientDataJSON` only matters if the passkey signs it, and the
challenge must still match.

**The challenge decoder accepts non-canonical trailing bits.** The decoded 32
bytes are compared to the expected challenge, so two spellings of the same bytes
authorize the same thing.

**`verify` is CPI-callable and takes the caller's challenge.** Freshness and
domain separation of `message_hash` are the integrating program's job. Most
integrators check taps off-chain instead (`verifyResponse` in the SDK) and read
the token account. Because `message_hash` is not domain-tagged, anyone holding a
pending `set_owner` assertion can submit it to `verify` with that challenge,
advancing the sign count so the claim fails. Whoever can do that can already
claim the token with it (the challenge does not name the recipient), so this
adds no new attacker.

**Strictly increasing sign count.** Authenticators that always report 0 cannot
be used as accessories.

**Arithmetic and indexing fail closed.** See [INVARIANTS F2](../program/INVARIANTS.md#failure-behavior).

## App server

**No in-app rate limiting.** The public endpoints (`/api/tap/challenge`,
`/api/owner/challenge`, `/api/pair` and `/api/link`) are rate-limited in the
Cloudflare dashboard, not in code. Until that is configured,
a flood can grow the shared `auth_challenges` table, which is pruned per
namespace on the next insert.

**`noUncheckedIndexedAccess` is not enabled in the app.** It is on in the SDK
and MCP server. In the app it flags many sites, almost all in tests; the link
transaction validator checks lengths before it indexes.

**The owner login lasts 30 days** (`OWNER_SESSION_TTL_MS`). It only grants a
view-only `owner_browse` after a fresh on-chain owner check; every owner action
still needs a wallet signature.
