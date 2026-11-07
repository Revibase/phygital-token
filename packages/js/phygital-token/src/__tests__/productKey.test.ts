import { describe, expect, it } from "vitest";

import { AUTHORIZE_PREFIX, MAX_AUTHORIZE_PAYLOAD } from "../utils/consts.js";
import { buildProductAllowListId } from "../utils/passkey/productKey.js";

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("buildProductAllowListId", () => {
  it("is authorize || payload, 10–640 bytes", () => {
    expect(AUTHORIZE_PREFIX).toEqual(utf8("authorize"));
    expect(MAX_AUTHORIZE_PAYLOAD).toBe(631);
    expect(buildProductAllowListId(utf8("x"))).toEqual(utf8("authorizex"));
    expect(buildProductAllowListId(new Uint8Array(MAX_AUTHORIZE_PAYLOAD))).toHaveLength(640);
  });

  it("refuses payloads the card would not sign", () => {
    expect(() => buildProductAllowListId(new Uint8Array(0))).toThrow(/1–631/);
    expect(() => buildProductAllowListId(new Uint8Array(MAX_AUTHORIZE_PAYLOAD + 1))).toThrow(
      /1–631/,
    );
  });
});
