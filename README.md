# ABI Viewer

A browser-based tool for viewing and comparing Applied Biosystems fragment analysis files (.fsa, .ab1). All processing happens client-side — no data leaves your machine.

**[Try it online](https://bioinfcomav.github.io/abi-viewer/)**

## Features

- **Load files** via drag & drop or file picker (.fsa, .ab1)
- **Channel selection** — switch between fluorescence channels (6-FAM, VIC, NED, PET, LIZ, etc.)
- **Standard overlay** — display the size standard channel behind the selected channel with independent Y-scale
- **Interactive navigation** — drag to pan, mouse wheel to zoom, per-widget sliders for Y-scale and X-zoom
- **Lock widgets** — synchronize pan, zoom, and Y-scale across all electropherograms
- **Auto-align** — automatically align electropherograms by detecting size standard peaks and computing affine transforms

## Quick start

```bash
cd ts
npm install
npm run dev
```

Open http://localhost:5173/ and drop some .fsa files, or click "Load example files".

## Build for deployment

```bash
cd ts
./scripts/build-ghpages.sh
```

This runs the full check (TypeScript types, Biome lint, Vitest tests) then builds the production bundle into `dist/`. Copy the contents to your web server or GitHub Pages repository.

## Project structure

```
ts/                          # TypeScript web application
  src/
    abi-parser.ts            # ABIF binary format parser
    components/              # React components
      App.tsx                # Main layout and state
      ElectropherogramWidget.tsx  # Canvas-based trace viewer
      ChannelSelector.tsx    # Dye/channel picker
      FileUpload.tsx         # Drag & drop file loader
    lib/
      render-electropherogram.ts  # Pure canvas drawing functions
      peak-detection.ts      # Prominence-based peak detection
      align-peaks.ts         # Affine alignment via least-squares
  tests/                     # Vitest tests against real .fsa fixtures
  public/examples/           # Example .fsa files for the demo
python/                      # Python utilities (parser, gel image generator)
ai/skills/                   # Reusable AI skill prompts
```

## Toolchain

| Tool | Role |
|------|------|
| [Vite](https://vite.dev/) | Build and dev server |
| [React](https://react.dev/) | UI components |
| [TypeScript](https://www.typescriptlang.org/) | Language (strict mode) |
| [Vitest](https://vitest.dev/) | Test runner |
| [Biome](https://biomejs.dev/) | Lint and format |

## Running tests

```bash
cd ts
npm test           # run once
npm run test:watch # watch mode
npm run check      # types + lint + tests
```

## License

MIT
