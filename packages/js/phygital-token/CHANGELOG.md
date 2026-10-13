# Changelog

All notable changes to this artifact are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Breaking

- `beginTransfer` requires `recipient`, and `TransferSession` carries it: the
  `set_owner` challenge now names the new owner (matches the program). Choose
  the wallet before the tap. `completeTransfer` throws `RECIPIENT_MISMATCH`
  for any other signer.

## [1.10.0]

First public release.
