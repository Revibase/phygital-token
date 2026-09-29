import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const distIndex = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/index.js",
);

const content = await readFile(distIndex, "utf8");
if (!content.startsWith("#!")) {
  await writeFile(distIndex, `#!/usr/bin/env node\n${content}`);
}
