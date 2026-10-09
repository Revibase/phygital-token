import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = '.svelte-kit/cloudflare';
const forbidden = ['__simulation/', 'simulation_session', 'simulation-intent-0001', 'isolated-browser-simulation', 'LADS POKER', 'Simulation NFT', 'test/browser/'];
let checked = 0;
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { await check(path); continue; }
    if (!/\.(js|mjs|json|html|map|css)$/.test(entry.name)) continue;
    const content = await readFile(path, 'utf8');
    for (const marker of forbidden) {
      if (content.includes(marker)) throw new Error(`Test fixture found in production output: ${path} (${marker})`);
    }
    checked++;
  }
}
await check(root);
console.log(`Checked ${checked} production files: no simulation fixtures or mockups.`);
