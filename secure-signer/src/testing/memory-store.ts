import type { BlobStore } from "../blob-store.js";

/**
 * In-memory `BlobStore`. `mode` reproduces storage failures:
 * - "drop-writes": put succeeds but nothing persists (Safari partitioned storage)
 * - "throw": every access throws (storage disabled)
 */
export class MemoryBlobStore implements BlobStore {
  raw: Uint8Array | null = null;
  mode: "ok" | "drop-writes" | "throw" = "ok";

  async get(): Promise<Uint8Array | null> {
    if (this.mode === "throw") throw new Error("storage unavailable");
    return this.raw ? this.raw.slice() : null;
  }

  async put(raw: Uint8Array): Promise<void> {
    if (this.mode === "throw") throw new Error("storage unavailable");
    if (this.mode === "drop-writes") return;
    this.raw = raw.slice();
  }
}
