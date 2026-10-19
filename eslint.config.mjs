// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.svelte-kit/**",
      "**/.wrangler/**",
      "target/**",
      "graphify-out/**",
      "**/results/**",
      // Generated code: regenerate instead of editing.
      "packages/js/phygital-token/src/generated/**",
      "app/worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: {
          // Root-level config files that no package tsconfig includes.
          allowDefaultProject: ["eslint.config.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".svelte"],
      },
    },
  },
  {
    rules: {
      // Async functions without await are used to satisfy async interfaces.
      "@typescript-eslint/require-await": "off",
      // `let ok = false; try { ok = verify(...) } catch { ok = false }` is a
      // deliberate fail-closed default in the verification code.
      "no-useless-assignment": "off",
      // The app is served from the origin root and links out to explorers.
      "svelte/no-navigation-without-resolve": "off",
      // Flags function-local Maps/Sets that are never reactive state.
      "svelte/prefer-svelte-reactivity": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    // Svelte rune modules: the Svelte parser delegates script to TypeScript.
    files: ["**/*.svelte.ts"],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    // ESLint cannot see SvelteKit's generated `./$types`, so type-aware rules
    // report false positives in components. svelte-check type-checks them.
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, projectService: false, program: null },
    },
    rules: tseslint.configs.disableTypeChecked.rules,
  },
  {
    // Trust boundary: browser-reachable code must never import server modules
    // (secrets, D1, signing keys). SvelteKit enforces this at build time too.
    files: ["app/src/lib/client/**", "app/src/lib/shared/**", "app/src/lib/components/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["$lib/server", "$lib/server/*", "**/server/**"],
              message: "Server-only module.",
            },
          ],
        },
      ],
    },
  },
  {
    // Route modules type their load functions through SvelteKit's generated
    // `./$types`, which ESLint resolves less precisely than svelte-check; the
    // assertions there narrow loader output for the page components.
    files: ["app/src/routes/**/*.ts"],
    rules: { "@typescript-eslint/no-unnecessary-type-assertion": "off" },
  },
  {
    // Tests and fixtures poke at loosely typed mocks and JSON.
    files: ["**/__tests__/**", "**/*.test.ts", "**/test/**", "**/testing/**"],
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/prefer-promise-reject-errors": "off",
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
);
