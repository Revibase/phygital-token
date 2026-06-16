import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(path));
      continue;
    }
    if (entry.name.endsWith(".js")) {
      files.push(path);
    }
  }
  return files;
}

function fixSpec(dir, spec) {
  if (spec.endsWith(".js")) {
    return spec;
  }

  const resolved = join(dir, spec);
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    return `${spec}/index.js`;
  }
  if (existsSync(`${resolved}.js`)) {
    return `${spec}.js`;
  }
  return spec;
}

function fixFile(file) {
  const dir = dirname(file);
  const source = readFileSync(file, "utf8");
  const updated = source.replace(/from "(\.\/[^"]+)"/g, (match, spec) => {
    const fixed = fixSpec(dir, spec);
    return fixed === spec ? match : `from "${fixed}"`;
  });

  if (updated !== source) {
    writeFileSync(file, updated);
  }
}

for (const file of walk("dist")) {
  fixFile(file);
}
