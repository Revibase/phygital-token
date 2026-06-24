import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(
  packageRoot,
  "src/generated/types/secp256r1_verify_args.rs",
);

const source = readFileSync(target, "utf8");

const patched = source.replace(
  /#\[derive\(BorshSerialize, BorshDeserialize, Clone, Debug, Eq, PartialEq\)\]\s*\n(pub struct Secp256r1VerifyArgs)/,
  `#[derive(Clone, Debug, Eq, PartialEq)]
#[cfg_attr(not(feature = "anchor"), derive(borsh::BorshSerialize, borsh::BorshDeserialize))]
#[cfg_attr(feature = "anchor", derive(anchor_lang::AnchorSerialize, anchor_lang::AnchorDeserialize))]
$1`,
);

if (patched === source) {
  throw new Error(
    `Expected to patch Secp256r1VerifyArgs derives in ${target}; codama output may have changed`,
  );
}

writeFileSync(target, patched);
