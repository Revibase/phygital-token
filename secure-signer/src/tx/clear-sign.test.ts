import { describe, expect, it } from "vitest";
import { none, some, address } from "@solana/kit";
import {
  describeInnerInstruction,
  describePolicyActions,
  formatUnits,
  windowPhrase,
} from "./clear-sign.js";

const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
// The real SPL Memo program (v2). An earlier copy of this test used a wrong address, which hid that real memos were shown as unknown calls.
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

describe("clear-sign", () => {
  it("formats SOL transfers", () => {
    const data = Uint8Array.from([2, 0, 0, 0, 0, 202, 154, 59, 0, 0, 0, 0]);
    const cleared = describeInnerInstruction(
      SYSTEM,
      ["Wallet11111111111111111111111111111111", "Dest111111111111111111111111111111111"],
      data,
    );
    expect(cleared.title).toBe("Send 1 SOL");
    expect(cleared.details.map((d) => d.label)).toEqual(["Amount", "From", "To"]);
    expect(cleared.details[0]?.value).toBe("1 SOL");
  });

  it("formats transfer-checked amounts", () => {
    const data = Uint8Array.from([12, 232, 3, 0, 0, 0, 0, 0, 0, 6]);
    const cleared = describeInnerInstruction(
      TOKEN,
      ["SrcAta", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "DstAta", "Owner"],
      data,
    );
    expect(cleared.title).toBe("Send 0.001 USDC");
    expect(cleared.details.find((d) => d.label === "To token account")?.value).toBe("DstAta");
  });

  it("decodes memos as utf8", () => {
    const text = "hello-token-pda";
    const cleared = describeInnerInstruction(MEMO, [], new TextEncoder().encode(text));
    expect(cleared.title).toBe("Memo");
    expect(cleared.details[0]?.value).toBe(text);
  });

  it("formats transfer-checked with mint symbol when known", () => {
    const data = Uint8Array.from([12, 80, 195, 0, 0, 0, 0, 0, 0, 6]);
    const cleared = describeInnerInstruction(
      TOKEN,
      ["SrcAta", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "DstAta", "Owner"],
      data,
    );
    expect(cleared.title).toContain("0.05 USDC");
    expect(cleared.title).not.toMatch(/raw/i);
  });

  it("formats units and windows", () => {
    expect(formatUnits(1_000_000_000n, 9)).toBe("1");
    expect(windowPhrase(0n)).toBe("in total");
    expect(windowPhrase(3_600n)).toBe("every hour");
    expect(windowPhrase(7_200n)).toBe("every 2 hours");
    expect(windowPhrase(90n)).toBe("every 90 seconds");
    expect(windowPhrase(172_800n)).toBe("every 2 days");
  });

  it("flags unknown programs as opaque (not silently 'normal')", () => {
    const row = describeInnerInstruction(
      "Evi1Prog1111111111111111111111111111111111",
      ["a", "b"],
      new Uint8Array([1, 2, 3]),
    );
    expect(row.title).toBe("Call an unknown program");
    expect(row.details[0]).toEqual({
      label: "Program",
      value: "Evi1Prog1111111111111111111111111111111111",
    });
    expect(row.opaque).toBe(true);
  });

  it("describes tap-payment policy actions", () => {
    const rows = describePolicyActions([
      {
        __kind: "SetSolCap",
        fields: [some({ cap: 500_000_000n, windowSeconds: 86_400n, maxPerTx: 0n })],
      },
      { __kind: "SetSolCap", fields: [none()] },
      {
        __kind: "SetMintCap",
        fields: [
          address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
          { cap: 20_000_000n, windowSeconds: 86_400n, maxPerTx: 5_000_000n },
        ],
      },
      {
        __kind: "RemoveMintCap",
        fields: [address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")],
      },
      { __kind: "SetAllowedOrigins", fields: [["https://app.example", "https://www.app.example"]] },
      { __kind: "SetAllowedOrigins", fields: [[]] },
    ]);
    expect(rows).toEqual([
      { label: "SOL taps can spend", value: "0.5 SOL every day" },
      { label: "SOL taps can spend", value: "None" },
      { label: "Token taps can spend", value: "20 USDC every day, at most 5 USDC per payment" },
      { label: "Mint", value: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
      { label: "Token taps can spend", value: "None" },
      { label: "Mint", value: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
      { label: "Taps allowed from", value: "https://app.example\nhttps://www.app.example" },
      { label: "Taps allowed from", value: "Any site" },
    ]);
  });

  it("names transfer rules and warns about constrained destructive rules", () => {
    const programId = address(TOKEN);
    const rule = (selector: number, dataLength = none<number>()) => ({
      selector: Uint8Array.of(selector),
      dataLength,
      accountCount: none<number>(),
      accounts: [],
      arguments: [],
    });
    const rows = describePolicyActions([
      {
        __kind: "SetProgramPermission",
        fields: [
          { programId, access: { __kind: "Restricted", fields: [[rule(12), rule(8, some(9))]] } },
        ],
      },
    ]);
    expect(rows.some((r) => r.value === "Transfer checked")).toBe(true);
    expect(rows.some((r) => r.label === "Permission warning" && r.value.includes("Burn"))).toBe(
      true,
    );
    expect(rows).toContainEqual({ label: "Allowed instruction", value: "Burn" });
    expect(rows).toContainEqual({
      label: "Only if",
      value: "the instruction data is exactly 9 bytes",
    });
    expect(rows.some((r) => r.label === "Rule details" || /[{}]/.test(r.value))).toBe(false);
  });

  it("treats closing a token account back to the signer as safe", () => {
    const owner = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
    const close = (to: string) =>
      describeInnerInstruction(
        TOKEN,
        [
          "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T",
          to,
          "So11111111111111111111111111111111111111112",
        ],
        Uint8Array.of(9),
        owner,
      );
    expect(close(owner).dangerous).toBe(false);
    expect(close("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM").dangerous).toBe(true);
  });

  it("flags token approvals / authority changes / closes as dangerous", () => {
    for (const disc of [4, 13, 6, 9]) {
      const row = describeInnerInstruction(
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        ["acct", "delegate", "owner"],
        new Uint8Array([disc, 0, 0, 0, 0, 0, 0, 0, 0]),
      );
      expect(row.dangerous).toBe(true);
    }
  });

  it("only labels Metaplex/Bubblegum/Core as a transfer on the transfer discriminator", () => {
    const metaOther = describeInnerInstruction(
      "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
      ["a"],
      new Uint8Array([50]),
    );
    expect(metaOther.title).not.toMatch(/Transfer/);
    expect(metaOther.opaque).toBe(true);
    expect(
      describeInnerInstruction(
        "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
        ["a"],
        new Uint8Array([49]),
      ).title,
    ).toBe("Send NFT");
    expect(
      describeInnerInstruction(
        "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY",
        ["a"],
        new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      ).opaque,
    ).toBe(true);
    expect(
      describeInnerInstruction(
        "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
        ["a"],
        new Uint8Array([14]),
      ).title,
    ).toBe("Send NFT");
  });

  it("shows full recipient addresses in details (anti address-poisoning)", () => {
    const to = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    const data = new Uint8Array(12);
    data[0] = 2;
    const row = describeInnerInstruction(
      "11111111111111111111111111111111",
      ["FromAcct1111111111111111111111111111111111", to],
      data,
    );
    expect(row.details.find((d) => d.label === "To")?.value).toBe(to);
  });
});
