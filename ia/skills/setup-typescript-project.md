# Skill: Setup TypeScript Project

Set up a professional TypeScript project for a static web application.
This skill produces a reproducible, strict, well-tested project structure
using modern tooling.

## Toolchain

| Role             | Tool       | Why                                                        |
|------------------|------------|------------------------------------------------------------|
| Package manager  | **npm**    | Ships with Node.js, universal, widest tutorial coverage    |
| Build & dev      | **Vite**   | Fast HMR, native ESM, zero-config TypeScript support       |
| Test runner      | **Vitest** | Native Vite integration, fast, good integration test story |
| Lint & format    | **Biome**  | Single tool for both, very fast, good TS defaults          |
| Language         | **TypeScript** | Strict mode, no `any` escape hatches                   |

## Step 1 — Scaffold the project

```bash
npm create vite@latest <project-name> -- --template vanilla-ts
cd <project-name>
npm install
```

Remove boilerplate files that Vite generates (`counter.ts`, `style.css` contents,
`typescript.svg`, etc.) but keep the structural files (`index.html`, `src/main.ts`,
`tsconfig.json`, `vite.config.ts`).

## Step 2 — Configure TypeScript strictly

Replace `tsconfig.json` with:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],

    // Strict type checking — all of these matter
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,

    // Module interop
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "moduleDetection": "force",
    "erasableSyntaxOnly": true,

    // Output
    "noEmit": true,
    "sourceMap": true

    // Path aliases — configure in vite.config.ts, not here.
    // baseUrl/paths are deprecated in TypeScript 6+.
  },
  "include": ["src"]
}
```

If path aliases are used, also configure them in `vite.config.ts`:

```ts
import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
```

## Step 3 — Install and configure Biome

```bash
npm add -D @biomejs/biome
npx biome init
```

Replace the generated `biome.json` with:

```jsonc
{
  "$schema": "https://biomejs.dev/schemas/2.0/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "complexity": {
        "noExcessiveCognitiveComplexity": "warn"
      },
      "suspicious": {
        "noExplicitAny": "error"
      },
      "style": {
        "noNonNullAssertion": "warn",
        "useConst": "error"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "files": {
    "ignore": ["dist", "node_modules", "*.min.js"]
  }
}
```

Key rules:
- `noExplicitAny: "error"` — forces proper typing, no `any` escape hatch.
- `noNonNullAssertion: "warn"` — discourages `!` operator; prefer narrowing.
- `noExcessiveCognitiveComplexity: "warn"` — flags functions that are too complex.

## Step 4 — Install and configure Vitest

```bash
npm add -D vitest
```

Add to `vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    globals: false,          // explicit imports, no magic globals
    environment: "node",     // use "jsdom" only for tests that need DOM
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/main.ts", "src/**/*.d.ts"],
    },
  },
});
```

## Step 5 — Project structure

```
<project-name>/
├── biome.json
├── index.html
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main.ts              # app entry point (wired into index.html)
│   ├── <module>/             # feature modules
│   │   ├── <module>.ts       # implementation
│   │   └── types.ts          # types for this module (if needed)
│   └── lib/                  # shared utilities
│       └── ...
└── tests/
    ├── <module>.test.ts      # tests mirror src/ modules
    └── fixtures/             # test data files (binary samples, JSON, etc.)
```

Guidelines:
- **One module = one concern.** Each directory under `src/` owns a feature.
- **Types live near the code** that uses them, not in a global `types/` folder.
- **No barrel files** (`index.ts` re-exports) unless the module is a public API.
  Barrel files create circular dependency headaches and slow down tooling.
- **Tests mirror the source tree** by name, in a separate `tests/` directory.

## Step 6 — Package.json scripts

```jsonc
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage",
    "lint": "biome check .",
    "lint:fix": "biome check --fix .",
    "format": "biome format --write .",
    "check": "tsc --noEmit && biome check . && vitest run"
  }
}
```

- `pnpm check` is the single command that verifies everything: types, lint, tests.
- `pnpm build` also type-checks before building (catches errors Vite alone misses
  because Vite strips types without checking them).

## Testing philosophy

### Prefer real code over mocks

Mocks are a **parallel codebase** that diverges from reality. Every mock is a
maintenance liability and a place where tests can pass while real code breaks.

**Rules:**
1. **No mocking of internal modules.** If `moduleA` calls `moduleB`, the test
   should exercise both. That is the point of the test.
2. **Mock only at system boundaries** — network requests (`fetch`), filesystem,
   browser APIs that aren't available in the test environment, timers.
3. **For system boundary mocks, keep them thin.** A mock should return realistic
   data structures, not simplified stand-ins.
4. **When DOM is needed**, use Vitest's `jsdom` environment (set per-file with
   `// @vitest-environment jsdom`) rather than mocking DOM APIs by hand.

### Test structure

```ts
import { describe, it, expect } from "vitest";

describe("ModuleName", () => {
  // Tests within a describe block may share state and build on each other.
  // This is intentional — it tests the real usage sequence, not isolated atoms.

  it("parses a valid input", () => {
    const result = parse(validInput);
    expect(result.field).toBe(expectedValue);
  });

  it("uses the parsed result in a downstream operation", () => {
    // This test depends on the parser working correctly.
    // That is fine — if parsing breaks, this test surfaces it too.
    const result = parse(validInput);
    const output = transform(result);
    expect(output).toMatchObject({ ... });
  });
});
```

### Test data

- Place binary fixtures and sample data in `tests/fixtures/`.
- Load them with `fs.readFileSync` in tests (Vitest runs in Node, so this works).
- For data that is expensive to generate, commit it to the repo rather than
  regenerating it in each test run.

### What to test

| Priority | What                         | How                                          |
|----------|------------------------------|----------------------------------------------|
| High     | Core logic / parsers         | Real inputs from fixtures, verify outputs    |
| High     | Data transformations         | Chain real operations, check end-to-end      |
| Medium   | Error handling               | Feed malformed inputs, verify error messages |
| Medium   | Edge cases                   | Empty inputs, boundary values, large data    |
| Low      | UI rendering                 | Only if critical; prefer manual review       |
| Avoid    | Implementation details       | Don't test private functions directly        |

## TypeScript best practices

### Types

- **Define types for your domain first**, before writing implementation.
  Types are the design — they make you think about shape before behavior.
- **Use `interface` for object shapes** that external code will implement or extend.
  Use `type` for unions, intersections, and computed types.
- **Avoid `enum`** — use `as const` objects or union literal types instead.
  Enums have surprising runtime behavior and don't tree-shake well.

```ts
// Prefer this:
const DyeChannel = { FAM: "6-FAM", VIC: "VIC", NED: "NED" } as const;
type DyeChannel = (typeof DyeChannel)[keyof typeof DyeChannel];

// Over this:
enum DyeChannel { FAM = "6-FAM", VIC = "VIC", NED = "NED" }
```

- **Use `unknown` instead of `any`** for values of uncertain type. Then narrow
  with type guards.
- **Use branded types** for values that are structurally identical but semantically
  different (e.g., pixels vs. scan indices):

```ts
type ScanIndex = number & { readonly __brand: "ScanIndex" };
type Pixel = number & { readonly __brand: "Pixel" };
```

### Error handling

- **Throw real `Error` objects** with descriptive messages, never strings.
- **Use discriminated unions** for expected failure modes rather than exceptions:

```ts
type ParseResult =
  | { ok: true; data: AbifFile }
  | { ok: false; error: string };
```

- **Exceptions are for bugs** (programmer errors). Discriminated unions are for
  expected failures (bad input, missing data).

### Code organization

- **Functions should do one thing** and be short enough to read without scrolling.
- **Prefer pure functions** — take input, return output, no side effects.
  Side effects (DOM manipulation, file I/O) belong at the edges.
- **Avoid classes unless you need stateful lifecycle management.** Plain functions
  and types cover most use cases. When a class is warranted, keep it small.
- **Export only what is needed.** Everything not exported is an implementation
  detail that you can refactor freely.

### Naming

- **Files**: `kebab-case.ts` (e.g., `abi-parser.ts`, `gel-renderer.ts`).
- **Types/interfaces**: `PascalCase` (e.g., `DirectoryEntry`, `AbifFile`).
- **Functions/variables**: `camelCase` (e.g., `parseAbifFile`, `rawChannels`).
- **Constants**: `UPPER_SNAKE_CASE` only for true global constants.
  Module-level `const` uses `camelCase`.

## Checklist

After running this skill, verify:

- [ ] `npm install` succeeds with no warnings
- [ ] `npm run dev` starts Vite dev server
- [ ] `npm run build` compiles with no type errors and produces `dist/`
- [ ] `npm test` runs and passes (at least one smoke test exists)
- [ ] `npm run lint` passes with no warnings
- [ ] `npm run check` runs types + lint + tests in one command
- [ ] `tsconfig.json` has `strict: true` and `noUncheckedIndexedAccess: true`
- [ ] No `any` types in source code
- [ ] No barrel `index.ts` files unless justified
- [ ] Test fixtures directory exists for binary/sample test data
