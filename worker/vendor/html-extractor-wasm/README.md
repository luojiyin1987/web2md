# html-extractor-wasm

This directory contains generated WebAssembly files from `html-extractor`.
The `workerd.js` entry initializes the module for Cloudflare Workers.

Source commit: `25ed7a4`

Binary SHA-256:

```text
524bb50c5de6cf9f928548d05328c33724acae250b1d0867ab8dda47949cc2da
```

Regenerate the source package in the adjacent repository:

```bash
cd ../html-extractor
wasm-pack build crates/html-extractor-wasm --release --target bundler
```

Copy the generated background JavaScript, type declarations, and WASM file.
Keep `workerd.js` as the Cloudflare-specific entry.
