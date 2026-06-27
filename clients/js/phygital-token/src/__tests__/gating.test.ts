import { describe, expect, it } from "vitest";
import {
  assetMatchesPredicate,
  evaluateGatingFilter,
  evaluateGatingTiers,
  formatGatingPredicate,
  Gating,
  GatingTraitValue,
  summarizeGatingEvaluationFailure,
  summarizeGatingFailure,
  type GatingAssetPredicate,
  type GatingFilter,
} from "../utils/gating.js";

const collection = "collection-mint-abc";
const otherCollection = "collection-mint-def";

const collectionAssetGold = {
  id: "nft-mint-1",
  grouping: [["collection", collection] as [string, string]],
  content: {
    metadata: {
      attributes: [
        { trait_type: "Rarity", value: "Gold" },
        { trait_type: "Level", value: 5 },
      ],
    },
  },
};

const collectionAssetSilver = {
  id: "nft-mint-1b",
  grouping: [
    { group_key: "collection", group_value: collection },
  ],
  content: {
    metadata: {
      attributes: [{ trait_type: "Rarity", value: "Silver" }],
    },
  },
};

const otherNft = {
  id: "nft-mint-2",
  content: {
    metadata: {
      attributes: [{ trait_type: "Rarity", value: "Common" }],
    },
  },
};

const tokenAsset = {
  id: "token-mint-xyz",
  interface: "FungibleToken",
  token_info: {
    balance: 1_500_000,
    decimals: 6,
  },
};

const assets = [
  collectionAssetGold,
  collectionAssetSilver,
  otherNft,
  tokenAsset,
];

function expectPassed(filter: GatingFilter, passed = true) {
  const result = evaluateGatingFilter(assets, filter);
  expect(result.passed).toBe(passed);
  return result;
}

function expectPredicate(
  asset: (typeof assets)[number],
  predicate: GatingAssetPredicate,
  matches = true,
) {
  expect(assetMatchesPredicate(asset, predicate)).toBe(matches);
}

describe("string operators on mint", () => {
  it.each([
    ["eq hit", { mint: Gating.eq("nft-mint-2") }, otherNft, true],
    ["eq miss", { mint: Gating.eq("missing") }, otherNft, false],
    ["neq hit", { mint: Gating.neq("nft-mint-1") }, otherNft, true],
    ["neq miss", { mint: Gating.neq("nft-mint-2") }, otherNft, false],
    [
      "in hit",
      { mint: Gating.in("nft-mint-1", "nft-mint-2") },
      otherNft,
      true,
    ],
    ["in miss", { mint: Gating.in("nft-mint-1") }, otherNft, false],
    [
      "notIn hit",
      { mint: Gating.notIn("nft-mint-1", "nft-mint-1b") },
      otherNft,
      true,
    ],
    [
      "notIn miss",
      { mint: Gating.notIn("nft-mint-2", "nft-mint-1") },
      otherNft,
      false,
    ],
  ] as const)("%s", (_label, predicate, asset, matches) => {
    expectPredicate(asset, predicate, matches);
  });
});

describe("string operators on collection", () => {
  it.each([
    [
      "eq hit",
      { collection: Gating.eq(collection) },
      collectionAssetGold,
      true,
    ],
    [
      "eq miss",
      { collection: Gating.eq(otherCollection) },
      collectionAssetGold,
      false,
    ],
    [
      "neq hit",
      { collection: Gating.neq(otherCollection) },
      collectionAssetGold,
      true,
    ],
    [
      "neq miss",
      { collection: Gating.neq(collection) },
      collectionAssetGold,
      false,
    ],
    [
      "in hit",
      { collection: Gating.in(collection, otherCollection) },
      collectionAssetSilver,
      true,
    ],
    [
      "in miss",
      { collection: Gating.in(otherCollection) },
      collectionAssetSilver,
      false,
    ],
    [
      "notIn hit",
      { collection: Gating.notIn(otherCollection) },
      collectionAssetSilver,
      true,
    ],
    [
      "notIn miss",
      { collection: Gating.notIn(collection, otherCollection) },
      collectionAssetSilver,
      false,
    ],
    [
      "object grouping format",
      { collection: Gating.eq(collection) },
      collectionAssetSilver,
      true,
    ],
  ] as const)("%s", (_label, predicate, asset, matches) => {
    expectPredicate(asset, predicate, matches);
  });
});

describe("trait operators", () => {
  it.each([
    [
      "eq hit",
      Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
      collectionAssetGold,
      true,
    ],
    [
      "eq miss",
      Gating.trait("Rarity", GatingTraitValue.eq("Silver")),
      collectionAssetGold,
      false,
    ],
    [
      "eq case-insensitive",
      Gating.trait("rarity", GatingTraitValue.eq("gold")),
      collectionAssetGold,
      true,
    ],
    [
      "neq hit",
      Gating.trait("Rarity", GatingTraitValue.neq("Silver")),
      collectionAssetGold,
      true,
    ],
    [
      "neq miss",
      Gating.trait("Rarity", GatingTraitValue.neq("Gold")),
      collectionAssetGold,
      false,
    ],
    [
      "in hit",
      Gating.trait("Rarity", GatingTraitValue.in("Gold", "Platinum")),
      collectionAssetGold,
      true,
    ],
    [
      "in miss",
      Gating.trait("Rarity", GatingTraitValue.in("Silver", "Common")),
      collectionAssetGold,
      false,
    ],
    [
      "notIn hit",
      Gating.trait("Rarity", GatingTraitValue.notIn("Silver", "Common")),
      collectionAssetGold,
      true,
    ],
    [
      "notIn miss",
      Gating.trait("Rarity", GatingTraitValue.notIn("Gold", "Platinum")),
      collectionAssetGold,
      false,
    ],
    [
      "gte hit",
      Gating.trait("Level", GatingTraitValue.gte(5)),
      collectionAssetGold,
      true,
    ],
    [
      "gte miss",
      Gating.trait("Level", GatingTraitValue.gte(6)),
      collectionAssetGold,
      false,
    ],
    [
      "lte hit",
      Gating.trait("Level", GatingTraitValue.lte(5)),
      collectionAssetGold,
      true,
    ],
    [
      "lte miss",
      Gating.trait("Level", GatingTraitValue.lte(4)),
      collectionAssetGold,
      false,
    ],
    [
      "between hit",
      Gating.trait("Level", GatingTraitValue.between(4, 6)),
      collectionAssetGold,
      true,
    ],
    [
      "between miss",
      Gating.trait("Level", GatingTraitValue.between(6, 10)),
      collectionAssetGold,
      false,
    ],
    [
      "numeric string level",
      Gating.trait("Level", GatingTraitValue.eq("5")),
      collectionAssetGold,
      true,
    ],
  ] as const)("%s", (_label, trait, asset, matches) => {
    expectPredicate(asset, { traits: Gating.traitsAll(trait) }, matches);
  });

  it("traitsAll requires every trait on the same asset", () => {
    expectPredicate(collectionAssetGold, {
      traits: Gating.traitsAll(
        Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
        Gating.trait("Level", GatingTraitValue.eq(5)),
      ),
    });
    expectPredicate(
      collectionAssetGold,
      {
        traits: Gating.traitsAll(
          Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
          Gating.trait("Rarity", GatingTraitValue.eq("Silver")),
        ),
      },
      false,
    );
  });

  it("traitsAny passes when one trait matches", () => {
    expectPredicate(collectionAssetSilver, {
      traits: Gating.traitsAny(
        Gating.trait("Rarity", GatingTraitValue.eq("Mythic")),
        Gating.trait("Rarity", GatingTraitValue.eq("Silver")),
      ),
    });
    expectPredicate(
      collectionAssetSilver,
      {
        traits: Gating.traitsAny(
          Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
          Gating.trait("Rarity", GatingTraitValue.eq("Common")),
        ),
      },
      false,
    );
  });

  it("trait neq passes when trait_type is absent", () => {
    expectPredicate(tokenAsset, {
      traits: Gating.traitsAll(
        Gating.trait("Rarity", GatingTraitValue.neq("Gold")),
      ),
    });
  });
});

describe("balance on asset row", () => {
  it.each([
    ["min hit", Gating.balance(1_000_000n), true],
    ["min miss", Gating.balance(2_000_000n), false],
    ["max hit", Gating.balance(undefined, 2_000_000n), true],
    ["max miss", Gating.balance(undefined, 1_000_000n), false],
    ["range hit", Gating.balance(1_000_000n, 2_000_000n), true],
    ["range miss", Gating.balance(1_600_000n, 2_000_000n), false],
  ] as const)("%s", (_label, balance, matches) => {
    expectPredicate(
      tokenAsset,
      { mint: Gating.eq("token-mint-xyz"), balance },
      matches,
    );
  });

  it("balance alone matches any asset with sufficient token_info", () => {
    expectPredicate(tokenAsset, { balance: Gating.balance(1_000_000n) });
    expectPredicate(collectionAssetGold, { balance: Gating.balance(1n) }, false);
  });
});

describe("four-dimension predicate combinations", () => {
  const fullPredicate = {
    collection: Gating.eq(collection),
    mint: Gating.in("nft-mint-1", "nft-mint-1b"),
    traits: Gating.traitsAll(
      Gating.trait("Rarity", GatingTraitValue.in("Gold", "Silver")),
      Gating.trait("Level", GatingTraitValue.lte(10)),
    ),
  };

  it("matches gold NFT with collection + mint + traits", () => {
    expectPredicate(collectionAssetGold, fullPredicate);
  });

  it("fails silver NFT when level trait is missing", () => {
    expectPredicate(
      collectionAssetSilver,
      {
        ...fullPredicate,
        traits: Gating.traitsAll(
          Gating.trait("Rarity", GatingTraitValue.eq("Silver")),
          Gating.trait("Level", GatingTraitValue.gte(1)),
        ),
      },
      false,
    );
  });

  it("matches token with mint + balance", () => {
    expectPredicate(tokenAsset, {
      mint: Gating.eq("token-mint-xyz"),
      balance: Gating.balance(1_000_000n, 2_000_000n),
    });
  });

  it("count(1) across combined predicate", () => {
    expectPassed(Gating.count(1, fullPredicate));
  });
});

describe("Gating.count", () => {
  it("count(1) is existence", () => {
    expectPassed(Gating.count(1, { collection: Gating.eq(collection) }));
    expectPassed(
      Gating.count(1, { collection: Gating.eq("missing-collection") }),
      false,
    );
  });

  it("enforces minimum count", () => {
    const result = expectPassed(
      Gating.count(2, { collection: Gating.eq(collection) }),
    );
    expect(result.kind).toBe("count");
    if (result.kind === "count") {
      expect(result.matchCount).toBe(2);
    }
    expectPassed(Gating.count(3, { collection: Gating.eq(collection) }), false);
  });

  it("enforces maximum count", () => {
    expectPassed(
      Gating.count(1, { collection: Gating.eq(collection) }, 2),
    );
    expectPassed(
      Gating.count(1, { collection: Gating.eq(collection) }, 1),
      false,
    );
  });

  it("count(1, pred, 1) requires exactly one match", () => {
    expectPassed(
      Gating.count(1, { mint: Gating.eq("nft-mint-2") }, 1),
    );
    expectPassed(
      Gating.count(1, { collection: Gating.eq(collection) }, 1),
      false,
    );
  });

  it("count(0) always passes on match count", () => {
    expectPassed(Gating.count(0, { mint: Gating.eq("missing") }));
  });

  it("empty predicate matches every asset", () => {
    const result = expectPassed(Gating.count(4, {}));
    expect(result.kind).toBe("count");
    if (result.kind === "count") {
      expect(result.matchCount).toBe(4);
    }
  });

  it("reports matchCount in filterResult", () => {
    const result = evaluateGatingFilter(
      assets,
      Gating.count(1, {
        traits: Gating.traitsAny(
          Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
        ),
      }),
    );
    expect(result.kind).toBe("count");
    if (result.kind === "count") {
      expect(result.matchCount).toBe(1);
      expect(result.passed).toBe(true);
    }
  });
});

describe("Gating.totalBalance", () => {
  it.each([
    ["min hit", 1_000_000n, undefined, true],
    ["min miss", 2_000_000n, undefined, false],
    ["range hit", 1_000_000n, 2_000_000n, true],
    ["range miss", 1_000_000n, 1_400_000n, false],
    ["no bounds", undefined, undefined, true],
  ] as const)("%s", (_label, min, max, passed) => {
    const result = expectPassed(
      Gating.totalBalance("token-mint-xyz", min, max),
      passed,
    );
    if (result.kind === "totalBalance") {
      expect(result.total).toBe(1_500_000n);
    }
  });

  it("returns zero for unknown mint", () => {
    const result = expectPassed(
      Gating.totalBalance("unknown-mint", 1n),
      false,
    );
    if (result.kind === "totalBalance") {
      expect(result.total).toBe(0n);
    }
  });
});

describe("compositors", () => {
  it("AND requires every child", () => {
    expectPassed(
      Gating.and(
        Gating.count(2, { collection: Gating.eq(collection) }),
        Gating.count(1, { mint: Gating.eq("nft-mint-2") }),
      ),
    );
    expectPassed(
      Gating.and(
        Gating.count(2, { collection: Gating.eq(collection) }),
        Gating.count(1, { mint: Gating.eq("missing") }),
      ),
      false,
    );
  });

  it("OR passes when any child passes", () => {
    expectPassed(
      Gating.or(
        Gating.count(1, { mint: Gating.eq("missing") }),
        Gating.totalBalance("token-mint-xyz", 1_000_000n),
      ),
    );
    expectPassed(
      Gating.or(
        Gating.count(1, { mint: Gating.eq("missing-a") }),
        Gating.count(1, { mint: Gating.eq("missing-b") }),
      ),
      false,
    );
  });

  it("NOT inverts a child", () => {
    expectPassed(
      Gating.not(Gating.count(1, { mint: Gating.eq("missing") })),
    );
    expectPassed(
      Gating.not(Gating.count(1, { mint: Gating.eq("nft-mint-2") })),
      false,
    );
    expectPassed(
      Gating.not(Gating.count(1, { collection: Gating.eq(collection) })),
      false,
    );
  });

  it("nested AND/OR/NOT", () => {
    expectPassed(
      Gating.and(
        Gating.count(2, { collection: Gating.eq(collection) }),
        Gating.or(
          Gating.not(Gating.totalBalance("token-mint-xyz", 2_000_000n)),
          Gating.count(1, {
            traits: Gating.traitsAll(
              Gating.trait("Rarity", GatingTraitValue.eq("Mythic")),
            ),
          }),
        ),
        Gating.not(
          Gating.count(1, { mint: Gating.notIn("nft-mint-1", "nft-mint-1b", "nft-mint-2", "token-mint-xyz") }),
        ),
      ),
    );
  });

  it("deep filterResult tree for compositors", () => {
    const result = evaluateGatingFilter(
      assets,
      Gating.and(
        Gating.count(1, { collection: Gating.eq(collection) }),
        Gating.or(
          Gating.totalBalance("token-mint-xyz", 1_000_000n),
          Gating.count(1, { mint: Gating.eq("missing") }),
        ),
      ),
    );
    expect(result.kind).toBe("and");
    if (result.kind === "and") {
      expect(result.children).toHaveLength(2);
      expect(result.children[0]?.kind).toBe("count");
      expect(result.children[1]?.kind).toBe("or");
    }
  });
});

describe("wallet-level rule recipes", () => {
  it("hold two different mints via AND of count(1)", () => {
    expectPassed(
      Gating.and(
        Gating.count(1, { mint: Gating.eq("nft-mint-1") }),
        Gating.count(1, { mint: Gating.eq("nft-mint-2") }),
      ),
    );
  });

  it("exclude banned collection via NOT", () => {
    expectPassed(
      Gating.not(Gating.count(1, { collection: Gating.eq(otherCollection) })),
    );
    expectPassed(
      Gating.and(
        Gating.count(1, { collection: Gating.eq(collection) }),
        Gating.not(Gating.count(1, { collection: Gating.eq(otherCollection) })),
      ),
    );
  });

  it("alternative qualification paths via OR", () => {
    expectPassed(
      Gating.or(
        Gating.count(1, {
          collection: Gating.eq(collection),
          traits: Gating.traitsAll(
            Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
          ),
        }),
        Gating.totalBalance("token-mint-xyz", 1_000_000n),
      ),
    );
  });

  it("campaign rule: 2+ collection NFTs, 1 gold with level, enough tokens", () => {
    expectPassed(
      Gating.and(
        Gating.count(2, { collection: Gating.eq(collection) }),
        Gating.count(1, {
          collection: Gating.eq(collection),
          traits: Gating.traitsAll(
            Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
            Gating.trait("Level", GatingTraitValue.gte(5)),
          ),
        }),
        Gating.totalBalance("token-mint-xyz", 1_000_000n),
      ),
    );
  });
});

describe("summarizeGatingFailure", () => {
  it("returns empty array when filter passed", () => {
    expect(
      summarizeGatingFailure(
        evaluateGatingFilter(
          assets,
          Gating.count(1, { collection: Gating.eq(collection) }),
        ),
      ),
    ).toEqual([]);
  });

  it("describes count below minimum", () => {
    expect(
      summarizeGatingFailure(
        evaluateGatingFilter(
          assets,
          Gating.count(3, { collection: Gating.eq(collection) }),
        ),
      ),
    ).toEqual([
      "Need at least 3 asset(s) matching collection = collection-mint-abc; found 2.",
    ]);
  });

  it("describes count above maximum", () => {
    expect(
      summarizeGatingFailure(
        evaluateGatingFilter(
          assets,
          Gating.count(1, { collection: Gating.eq(collection) }, 1),
        ),
      ),
    ).toEqual([
      "Need at most 1 asset(s) matching collection = collection-mint-abc; found 2.",
    ]);
  });

  it("describes combined predicate in count failures", () => {
    expect(
      summarizeGatingFailure(
        evaluateGatingFilter(
          assets,
          Gating.count(1, {
            collection: Gating.eq(collection),
            traits: Gating.traitsAll(
              Gating.trait("Rarity", GatingTraitValue.eq("Mythic")),
            ),
          }),
        ),
      ),
    ).toEqual([
      "Need at least 1 asset(s) matching collection = collection-mint-abc, traits all [Rarity = Mythic]; found 0.",
    ]);
  });

  it("describes totalBalance too low", () => {
    expect(
      summarizeGatingFailure(
        evaluateGatingFilter(
          assets,
          Gating.totalBalance("token-mint-xyz", 2_000_000n),
        ),
      ),
    ).toEqual([
      "Need at least 2000000 raw balance for mint token-mint-xyz; found 1500000.",
    ]);
  });

  it("describes totalBalance too high", () => {
    expect(
      summarizeGatingFailure(
        evaluateGatingFilter(
          assets,
          Gating.totalBalance("token-mint-xyz", undefined, 1_000_000n),
        ),
      ),
    ).toEqual([
      "Need at most 1000000 raw balance for mint token-mint-xyz; found 1500000.",
    ]);
  });

  it("aggregates AND failures from every failed child", () => {
    expect(
      summarizeGatingFailure(
        evaluateGatingFilter(
          assets,
          Gating.and(
            Gating.count(3, { collection: Gating.eq(collection) }),
            Gating.totalBalance("token-mint-xyz", 2_000_000n),
          ),
        ),
      ),
    ).toEqual([
      "Need at least 3 asset(s) matching collection = collection-mint-abc; found 2.",
      "Need at least 2000000 raw balance for mint token-mint-xyz; found 1500000.",
    ]);
  });

  it("lists OR alternative failures", () => {
    expect(
      summarizeGatingFailure(
        evaluateGatingFilter(
          assets,
          Gating.or(
            Gating.count(1, { mint: Gating.eq("missing-a") }),
            Gating.count(1, { mint: Gating.eq("missing-b") }),
          ),
        ),
      ),
    ).toEqual([
      "None of the alternative conditions were met:",
      "  [1] Need at least 1 asset(s) matching mint = missing-a; found 0.",
      "  [2] Need at least 1 asset(s) matching mint = missing-b; found 0.",
    ]);
  });

  it("describes NOT failures when inner condition was met", () => {
    expect(
      summarizeGatingFailure(
        evaluateGatingFilter(
          assets,
          Gating.not(Gating.count(1, { mint: Gating.eq("nft-mint-2") })),
        ),
      ),
    ).toEqual([
      "Must not satisfy: 1 asset(s) matching mint = nft-mint-2.",
    ]);
  });

  it("describes nested campaign rule failures", () => {
    const messages = summarizeGatingFailure(
      evaluateGatingFilter(
        assets,
        Gating.and(
          Gating.count(3, { collection: Gating.eq(collection) }),
          Gating.count(1, {
            collection: Gating.eq(collection),
            traits: Gating.traitsAll(
              Gating.trait("Rarity", GatingTraitValue.eq("Mythic")),
            ),
          }),
          Gating.totalBalance("token-mint-xyz", 2_000_000n),
        ),
      ),
    );

    expect(messages).toEqual([
      "Need at least 3 asset(s) matching collection = collection-mint-abc; found 2.",
      "Need at least 1 asset(s) matching collection = collection-mint-abc, traits all [Rarity = Mythic]; found 0.",
      "Need at least 2000000 raw balance for mint token-mint-xyz; found 1500000.",
    ]);
  });
});

describe("formatGatingPredicate", () => {
  it("formats all four dimensions", () => {
    expect(
      formatGatingPredicate({
        collection: Gating.in("ColA", "ColB"),
        mint: Gating.eq("mint-1"),
        traits: Gating.traitsAny(
          Gating.trait("Level", GatingTraitValue.gte(5)),
          Gating.trait("Rarity", GatingTraitValue.in("Gold", "Silver")),
        ),
        balance: Gating.balance(100n, 200n),
      }),
    ).toBe(
      "collection in (ColA, ColB), mint = mint-1, traits any [Level >= 5; Rarity in (Gold, Silver)], balance between 100 and 200",
    );
  });
});

describe("evaluateGatingTiers", () => {
  const tierFilters = [
    Gating.tier(
      "bronze",
      Gating.count(1, { collection: Gating.eq(collection) }),
    ),
    Gating.tier(
      "silver",
      Gating.count(2, { collection: Gating.eq(collection) }),
    ),
    Gating.tier(
      "gold",
      Gating.count(1, {
        collection: Gating.eq(collection),
        traits: Gating.traitsAll(
          Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
          Gating.trait("Level", GatingTraitValue.gte(5)),
        ),
      }),
    ),
  ] as const;

  it("evaluates each tier independently", () => {
    const result = evaluateGatingTiers(assets, tierFilters);

    expect(result.tiers).toHaveLength(3);
    expect(result.tiers.map((tier) => [tier.id, tier.passed])).toEqual([
      ["bronze", true],
      ["silver", true],
      ["gold", true],
    ]);
    expect(result.passedTierIds).toEqual(["bronze", "silver", "gold"]);
    expect(result.passed).toBe(true);
  });

  it("returns only tiers that pass in passedTierIds", () => {
    const result = evaluateGatingTiers(assets, [
      Gating.tier("bronze", Gating.count(1, { mint: Gating.eq("nft-mint-2") })),
      Gating.tier(
        "silver",
        Gating.count(1, {
          collection: Gating.eq(collection),
          traits: Gating.traitsAll(
            Gating.trait("Rarity", GatingTraitValue.eq("Mythic")),
          ),
        }),
      ),
    ]);

    expect(result.passedTierIds).toEqual(["bronze"]);
    expect(result.tiers[1]?.passed).toBe(false);
  });

  it("returns no passed tiers when wallet qualifies for none", () => {
    const result = evaluateGatingTiers(assets, [
      Gating.tier(
        "vip",
        Gating.count(1, { mint: Gating.eq("missing-mint") }),
      ),
    ]);

    expect(result.passed).toBe(false);
    expect(result.passedTierIds).toEqual([]);
  });

  it("summarizes failures across tiers when none pass", () => {
    const result = evaluateGatingTiers(assets, [
      Gating.tier(
        "bronze",
        Gating.count(5, { collection: Gating.eq(collection) }),
      ),
      Gating.tier(
        "gold",
        Gating.totalBalance("token-mint-xyz", 9_000_000n),
      ),
    ]);

    expect(summarizeGatingEvaluationFailure(result)).toEqual([
      'Tier "bronze":',
      "  Need at least 5 asset(s) matching collection = collection-mint-abc; found 2.",
      'Tier "gold":',
      "  Need at least 9000000 raw balance for mint token-mint-xyz; found 1500000.",
    ]);
  });

  it("returns empty failure summary when any tier passes", () => {
    const result = evaluateGatingTiers(assets, tierFilters);
    expect(summarizeGatingEvaluationFailure(result)).toEqual([]);
  });
});
