# html-extractor-wasm

This directory contains generated WebAssembly files from `html-extractor`.
The browser loads the module through Vite.
The Worker does not load or run this module.

Do not copy or rename files manually.
Run the synchronization command from the `web2md` root:

```bash
pnpm wasm:build
```

The command uses the adjacent `html-extractor` repository by default.
Use `--source` to select a different source directory.

```bash
pnpm wasm:build -- --source /path/to/html-extractor
```

`manifest.json` records the source Git commit and all artifact hashes.
Run `pnpm wasm:check` to rebuild and compare the files.
