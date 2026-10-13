import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as sdk from "phygital-token-sdk";
import { describe, expect, it } from "vitest";
import { listDocs, readDocById } from "../src/lib/docs.js";
import { SDK_SURFACE } from "../src/lib/sdk-surface.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Leading identifier of an entry such as `beginTransfer({ rpc })`. */
const identifier = (entry: string) => /^[A-Za-z_]\w*/.exec(entry)?.[0];

const tsSections = [
  SDK_SURFACE.admin,
  SDK_SURFACE.initialize,
  SDK_SURFACE.assignMint,
  SDK_SURFACE.transfer,
  SDK_SURFACE.removeOwner,
  SDK_SURFACE.verifyComposable,
  SDK_SURFACE.verification,
  SDK_SURFACE.onChainComposition.client,
  SDK_SURFACE.tokenLookup,
  SDK_SURFACE.generated,
];

describe("list_sdk_exports", () => {
  it("names only exports the TypeScript SDK has", async () => {
    const report = await readFile(
      path.join(root, "packages/js/phygital-token/api/phygital-token-sdk.api.md"),
      "utf8",
    );
    const names = new Set(tsSections.flat().map(identifier));
    const missing = [...names].filter(
      (name) =>
        name !== undefined &&
        !(name in sdk) &&
        !new RegExp(`export (declare )?(type|interface|enum|class) ${name}\\b`).test(report),
    );
    expect(missing).toEqual([]);
  });

  it("names only types the Rust client generates", async () => {
    const dir = path.join(root, "packages/rust/phygital-token/src/generated");
    const files = await readdir(dir, { recursive: true });
    const sources = await Promise.all(
      files.filter((f) => f.endsWith(".rs")).map((f) => readFile(path.join(dir, f), "utf8")),
    );
    const all = sources.join("\n");
    const names = [...SDK_SURFACE.rustClient.cpi, ...SDK_SURFACE.rustClient.types];
    const missing = names.filter((name) => !new RegExp(`pub (struct|enum) ${name}\\b`).test(all));
    expect(missing).toEqual([]);
  });
});

describe("docs", () => {
  it("every listed doc can be read", async () => {
    const docs = await listDocs();
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) {
      expect((await readDocById(doc.id)).length, doc.id).toBeGreaterThan(0);
    }
  });

  it("rejects ids outside the list", async () => {
    await expect(readDocById("../../package.json")).rejects.toThrow();
  });
});
