# Program threat model

Scope: the on-chain program in `programs/phygital-token`. The passkey signer
iframe has its own model in [`secure-signer/THREAT_MODEL.md`](../../secure-signer/THREAT_MODEL.md);
the web app's server boundaries are in [`app/ARCHITECTURE.md`](../../app/ARCHITECTURE.md).
Guarantees are listed in [INVARIANTS.md](INVARIANTS.md).

## Assets

- **Token ownership.** The owner controls the wallet (`execute_with_owner`) and the
  policy.
- **Wallet contents.** SOL, tokens and NFTs held by each token's wallet PDA.
- **Authentication results.** Integrators trust `verify` (directly or by CPI) to
  mean "this accessory was tapped for this message".

## Actors and trust

| Actor | Trusted for | Not trusted for |
|-------|-------------|-----------------|
| Accessory (NFC chip with a P-256 key) | keeping its private key; incrementing its sign count; setting the user-present flag only on a physical tap | — |
| Admin / issuer / minter | see "Trusted roles" | — |
| Owner | anything their own wallet and policy allow | other tokens |
| Transaction submitter, fee payer, relayer, RPC | nothing | ordering, censoring or copying transactions |
| Web page requesting the tap | nothing on-chain; origin checks only bind browser taps | — |
| Programs called from the wallet | nothing; they may call back in | — |

## Trusted roles

These are trust assumptions, not bugs:

- **The issuer chooses each token's passkey, type and initial owner.** An issuer
  could register a key it controls instead of the chip's.
- **The admin can close any token** (`close_phygital_token`). The wallet PDA keeps
  its assets, and re-initializing the same passkey recreates the same token and
  wallet address with a type and owner the issuer chooses. Together, admin and
  issuer can therefore take control of any wallet.
- **The minter can change any token's `mint`.** The program does not use it;
  off-chain readers must not treat it as proof of anything.
- **Whoever first calls `create_config` becomes admin.** Deploy and initialize in
  one step and check the config before announcing the program (see Deployment).

## Threats and mitigations

| Threat | Mitigation | Invariant |
|--------|------------|-----------|
| Forge a tap without the chip | precompile signature, key read from the verified bytes only, key match | T1 |
| Replay a captured tap | strictly increasing sign count; slot-hash expiry | T4, T5 |
| Reuse a tap made for another action | domain-tagged challenges binding the token | T5 |
| Front-run a `set_owner` tap with another recipient | the challenge names the recipient | T5 |
| A relayer alters a tapped execute | challenge covers every inner instruction, account and flag | W2 |
| Wrap a tapped execute in a CPI, or hold it with a durable nonce | top-level only; nonce transactions refused | W3 |
| Inner instruction re-enters the program or writes its accounts | self-calls refused; token and policy unprivileged | W4 |
| Inner instruction reassigns or reallocates the wallet | owner and length checked after | W5 |
| Tap drains the wallet | per-program rules, per-asset caps with windows and per-execute limits | W6, W7 |
| Assets leave through a delegate or close authority | no delegate may remain; close authorities may not change | W8 |
| New owner inherits old grants | every owner change closes the policy | O3 |
| Malformed account or sysvar bytes crash the program | bounds-checked readers, no panics, no `unsafe` | F1 |

## Accepted limitations

- **Browser origin binds browser taps only.** A client talking CTAP2 to the chip
  directly writes its own `clientDataJSON`, including `origin`. The policy's
  allowed origins stop a different website from requesting a tap through a
  browser; they do not stop a native app.
- **`verify` does not choose freshness.** The caller's `message_hash` is the
  challenge; integrators must include a nonce or slot hash themselves.
- **Authenticators that always report a sign count of 0 cannot be used.** The
  count must increase.
- **Optional rpId check.** Only `verify` can check the rpId hash, and only when
  asked; `set_owner` and the execute instructions never do. With a standard
  authenticator a credential's key is scoped to one rpId, so the key match
  implies it. If the accessory's chip signs for any rpId with the same key,
  the challenge and sign count are the remaining protections.

## Deployment

`create_config` makes its first caller the admin, so it must be called in the
same transaction as the program deployment, or immediately after it, with the
resulting admin checked before the program is announced. See
[docs/audit/BUILD.md](../audit/BUILD.md#deploying). This was chosen over
restricting `create_config` to the upgrade authority in the program.
