import { defineConfig, type Plugin } from "vite";
import { handleVault, VAULT_PATH } from "./src/vault.js";

/** Serves `/vault` in dev with the same handler the Worker runs in production. */
const vault: Plugin = {
  name: "signer-vault",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url?.split("?")[0] !== VAULT_PATH) return next();
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const host = req.headers.host ?? "localhost";
      const response = await handleVault(
        new Request(`http://${host}${req.url}`, {
          method: req.method ?? "GET",
          headers,
          ...(chunks.length ? { body: new Uint8Array(Buffer.concat(chunks)) } : {}),
        }),
      );
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
  },
};

// The signer is a trusted, minimal static origin. The production build must be
// compatible with a strict `script-src 'self'` CSP (no inline scripts, no eval).
//
// - `assetsInlineLimit: 0` prevents Vite from inlining small assets as data:
//   URIs (which would need `img-src data:` etc. and muddy the CSP).
// - `modulePreload.polyfill: false` avoids Vite injecting an inline module-preload
//   polyfill <script> into index.html.
// - `scripts/assert-no-inline.mjs` (run in the build script) fails the build if
//   any inline <script> or on* handler survives, so a CSP regression can't ship.
export default defineConfig({
  root: ".",
  plugins: [vault],
  // phygital-token-sdk (Codama-generated) reads `process.env["NODE_ENV"]` at
  // module load. Vite's built-in define only substitutes the dot form, so we
  // replace `process.env` wholesale to keep the browser bundle from throwing
  // `process is not defined`. No real env is exposed — it is a constant object.
  define: { "process.env": JSON.stringify({ NODE_ENV: "production" }) },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        // Content-hashed, self-hosted assets.
        entryFileNames: "assets/[name].[hash].js",
        chunkFileNames: "assets/[name].[hash].js",
        assetFileNames: "assets/[name].[hash][extname]",
      },
    },
  },
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
});
