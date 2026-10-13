import { describe, expect, it } from "vitest";
import { getInstructionRuleEncoder, PHYGITAL_TOKEN_PROGRAM_ADDRESS } from "../generated/index.js";
import {
  isValidOrigin,
  parsePermissionSet,
  parseRule,
  hexToBytes,
  PermissionFormatError,
  ruleFromProgram,
  ruleToArgs,
  sameRule,
  type PermissionSet,
  type RuleJson,
} from "../permissions/format.js";

const STAKE = "Stake11111111111111111111111111111111111111";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const custom: RuleJson = {
  selector: "0c",
  dataLength: 10,
  accountCount: 4,
  accounts: [
    { index: 0, key: "wallet", writable: true },
    {
      index: 1,
      owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      data: [
        { offset: 0, bytes: "c6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61" },
      ],
    },
  ],
  args: [{ offset: 1, unsigned: { width: "u64", is: "le", value: "1000000" } }],
};

const set: PermissionSet = {
  v: 1,
  name: "Stake NFT",
  reason: "Stake your NFT from the app",
  programs: [
    { id: STAKE, access: "all", reason: "Stakes and unstakes" },
    {
      id: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      access: { only: [{ selector: "03" }, custom] },
    },
  ],
  limits: [
    { asset: "SOL", amount: "500000000", period: "day" },
    { asset: USDC, amount: "20000000", period: "week", maxPerTap: "5000000" },
  ],
  origins: ["https://app.example.com", "http://localhost:5173"],
};

describe("permission format", () => {
  it("accepts a full set and round-trips rules through the program's types byte for byte", () => {
    expect(parsePermissionSet(structuredClone(set))).toEqual(set);
    const encoded = getInstructionRuleEncoder().encode(ruleToArgs(custom));
    expect(ruleFromProgram(ruleToArgs(custom))).toEqual(custom);
    expect(
      getInstructionRuleEncoder().encode(ruleToArgs(ruleFromProgram(ruleToArgs(custom)))),
    ).toEqual(encoded);
    expect(sameRule(custom, { ...custom })).toBe(true);
    expect(sameRule(custom, { ...custom, dataLength: 11 })).toBe(false);
  });

  it.each([
    ["an unknown field", { ...set, extra: 1 }, /unknown field "extra"/],
    [
      "the phygital-token program",
      { ...set, programs: [{ id: PHYGITAL_TOKEN_PROGRAM_ADDRESS, access: "all" }] },
      /phygital-token program/,
    ],
    ["a program twice", { ...set, programs: [set.programs[0], set.programs[0]] }, /listed twice/],
    [
      "an empty rule list",
      { ...set, programs: [{ id: STAKE, access: { only: [] } }] },
      /at least one rule/,
    ],
    [
      "wrapped SOL as a mint",
      {
        ...set,
        limits: [
          { asset: "So11111111111111111111111111111111111111112", amount: "1", period: "day" },
        ],
      },
      /use "SOL"/,
    ],
    [
      "a zero limit",
      { ...set, limits: [{ asset: "SOL", amount: "0", period: "day" }] },
      /more than 0/,
    ],
    [
      "max above the amount",
      { ...set, limits: [{ asset: "SOL", amount: "1", period: "day", maxPerTap: "2" }] },
      /more than the amount/,
    ],
    [
      "a bad period",
      { ...set, limits: [{ asset: "SOL", amount: "1", period: "fortnight" }] },
      /period/,
    ],
    ["an origin with a path", { ...set, origins: ["https://app.example.com/"] }, /origins\[0\]/],
    [
      "an origin twice",
      { ...set, origins: ["https://app.example.com", "https://app.example.com"] },
      /listed twice/,
    ],
  ])("rejects %s", (_, value, message) => {
    expect(() => parsePermissionSet(value)).toThrow(message);
  });

  it("matches the program's origin check", () => {
    for (const ok of [
      "https://app.example.com",
      "https://a-b.example:8443",
      "http://localhost",
      "http://localhost:3000",
    ]) {
      expect(isValidOrigin(ok)).toBe(true);
    }
    for (const bad of [
      "https://App.example.com",
      "http://app.example.com",
      "app.example.com",
      "https://app.example.com/",
      "https://app.example.com:",
      "https://.example.com",
      "https://a:1:2",
      "https://app.example.com:123456",
    ]) {
      expect(isValidOrigin(bad)).toBe(false);
    }
  });

  it("treats an empty origin list as any site", () => {
    expect(parsePermissionSet({ ...set, origins: [] }).origins).toBeUndefined();
  });

  it.each([
    [
      "data length shorter than the selector",
      { selector: "0102", dataLength: 1 },
      /shorter than the selector/,
    ],
    [
      "an argument past the data length",
      {
        selector: "01",
        dataLength: 4,
        args: [{ offset: 1, unsigned: { width: "u64", is: "eq", value: "1" } }],
      },
      /past the data length/,
    ],
    [
      "an account past the account count",
      { selector: "01", accountCount: 1, accounts: [{ index: 1 }] },
      /account count/,
    ],
    [
      "account data without its owner",
      { selector: "01", accounts: [{ index: 0, data: [{ offset: 0, bytes: "00" }] }] },
      /owner program/,
    ],
    [
      "a value too big for its width",
      { selector: "01", args: [{ offset: 1, unsigned: { width: "u8", is: "eq", value: "256" } }] },
      /fit in u8/,
    ],
    ["uppercase hex", { selector: "0A" }, /hex/],
  ])("rejects a rule with %s, as the program would", (_, rule, message) => {
    expect(() => parseRule(rule)).toThrow(message);
  });

  const amount = (
    is: "eq" | "ne" | "lt" | "le" | "gt" | "ge",
    value: string,
    width: "u8" | "u64" = "u64",
  ) => ({ offset: 4, unsigned: { width, is, value } });
  it.each([
    [
      "more than 10,000 and less than 5,000",
      { selector: "02000000", args: [amount("gt", "10000"), amount("lt", "5000")] },
      /args\[1\]: can never match together with args\[0\]/,
    ],
    [
      "two different exact values",
      { selector: "02000000", args: [amount("eq", "5"), amount("eq", "6")] },
      /args\[1\]/,
    ],
    ["less than zero", { selector: "02000000", args: [amount("lt", "0")] }, /args\[0\]/],
    [
      "more than the largest value",
      { selector: "02000000", args: [amount("gt", "255", "u8")] },
      /args\[0\]/,
    ],
    [
      "an exact value it also excludes",
      { selector: "02000000", args: [amount("eq", "7"), amount("ne", "7")] },
      /args\[1\]/,
    ],
    [
      "a range whose every value is excluded",
      {
        selector: "02000000",
        args: [amount("ge", "1"), amount("le", "2"), amount("ne", "1"), amount("ne", "2")],
      },
      /args\[3\]: can never match together with args\[0\] and args\[1\] and args\[2\]/,
    ],
    [
      "bytes that disagree with the selector",
      { selector: "02000000", args: [{ offset: 0, bytes: "03" }] },
      /args\[0\]: can never match together with selector/,
    ],
    [
      "overlapping bytes that disagree",
      {
        selector: "02",
        args: [
          { offset: 4, bytes: "aabb" },
          { offset: 5, bytes: "cc" },
        ],
      },
      /args\[1\]/,
    ],
    [
      "one account with two addresses",
      {
        selector: "02",
        accounts: [
          { index: 0, key: STAKE },
          { index: 0, key: USDC },
        ],
      },
      /accounts\[1\]: can never match together with accounts\[0\]/,
    ],
    [
      "one account as signer and not",
      {
        selector: "02",
        accounts: [
          { index: 1, signer: true },
          { index: 1, signer: false },
        ],
      },
      /accounts\[1\]/,
    ],
    [
      "the wallet as a non-signer",
      { selector: "02", accounts: [{ index: 0, key: "wallet", signer: false }] },
      /accounts\[0\]: can never match together with the accessory wallet/,
    ],
    [
      "account data that disagrees across entries",
      {
        selector: "02",
        accounts: [
          { index: 1, owner: STAKE, data: [amount("gt", "9")] },
          { index: 1, data: [amount("lt", "3")] },
        ],
      },
      /accounts\[1\]/,
    ],
  ])("rejects checks that can never match together: %s", (_, rule, message) => {
    expect(() => parseRule(rule)).toThrow(message);
  });

  it("keeps checks that can match together", () => {
    for (const rule of [
      {
        selector: "02000000",
        args: [amount("ge", "1000"), amount("le", "5000"), amount("ne", "2000")],
      },
      { selector: "02000000", args: [amount("eq", "5"), amount("le", "5")] },
      {
        selector: "02000000",
        args: [{ offset: 0, bytes: "0200" }, { offset: 4, bytes: "01" }, amount("eq", "1", "u8")],
      },
      {
        selector: "02",
        accounts: [
          { index: 0, key: "wallet", signer: true },
          { index: 0, writable: true },
        ],
      },
      {
        selector: "02",
        accounts: [
          { index: 0, key: "wallet" },
          { index: 0, key: STAKE },
        ],
      },
    ])
      expect(() => parseRule(rule)).not.toThrow();
  });

  it.each([
    ["the same selector twice", ["0c", "0c"]],
    ["a selector that prefixes another", ["1a01", "1a"]],
  ])("rejects %s in one program, as the program would", (_, selectors) => {
    const programs = [{ id: STAKE, access: { only: selectors.map((selector) => ({ selector })) } }];
    expect(() => parsePermissionSet({ ...set, programs })).toThrow(/same instruction as rule 0/);
  });
});

describe("hexToBytes", () => {
  it("decodes even-length hex", () => {
    expect(hexToBytes("00ff10")).toEqual(Uint8Array.from([0, 255, 16]));
    expect(hexToBytes("")).toEqual(new Uint8Array());
  });

  it.each(["abc", "zz", "0x00", "12 34"])("rejects %j instead of producing other bytes", (hex) => {
    expect(() => hexToBytes(hex)).toThrow(PermissionFormatError);
  });
});
