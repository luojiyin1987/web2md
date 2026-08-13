# web2md

Convert public webpages into clean Markdown.

## Architecture

web2md is a React SPA with a Cloudflare Worker API.
The browser calls `POST /api/extract` with a public webpage URL.
The Worker fetches a bounded HTML response and validates each redirect.
It then runs the vendored `html-extractor` Rust core through WebAssembly.

The Worker limits HTML input to 2 MiB.
It rejects private network URLs and non-HTML responses.
The deployment does not require an external extraction service or API key.

## Development

Install dependencies and start the Cloudflare Vite development server:

```bash
pnpm install
pnpm dev
```

The Cloudflare Vite plugin runs the API in workerd.
Local development uses the production runtime model.

## Testing

Run the Worker test suite:

```bash
pnpm test
```

The tests run inside workerd.
They load the production WASM module and mock outbound requests.

## CPU verification

WASM extraction runs synchronously.
Workers Free currently allows 10 ms of CPU time per request.
Local tests do not enforce this production limit.
Remote checks exceeded 10 ms for every successful extraction.
The current server-side WASM design requires Workers Paid.

Before release, test small, medium, 1 MiB, and near-2 MiB HTML pages.
Check Worker logs for error 1102 after each test.

See the [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## WebAssembly package

The compiled package lives in `worker/vendor/html-extractor-wasm`.
The repository tracks the WASM file to make builds reproducible.

To update it, build the adjacent `html-extractor` repository:

```bash
cd ../html-extractor
wasm-pack build crates/html-extractor-wasm --release --target bundler
```

Copy these generated files into `web2md/worker/vendor/html-extractor-wasm`:

- `html_extractor_wasm_bg.js`
- `html_extractor_wasm_bg.wasm`
- `html_extractor_wasm.d.ts` as `workerd.d.ts`

Keep the existing `workerd.js` entry.
It initializes the WASM module with Cloudflare Workers module semantics.

## Type generation

Generate Cloudflare runtime types after each Wrangler configuration change:

```bash
pnpm cf-typegen
```

The command excludes environment bindings because this Worker has none.

## Deployment

Build and deploy the SPA and Worker together:

```bash
pnpm deploy
```

Cloudflare serves the React assets.
It routes `/api/*` through the Worker.

## Extraction API contract

```http
POST /api/extract
content-type: application/json

{"url":"https://example.com/article"}
```

Successful responses return Markdown and extraction metadata:

```json
{
  "markdown": "# Example",
  "metadata": {
    "title": "Example",
    "sourceUrl": "https://example.com/article",
    "wordCount": 320,
    "pageType": "article",
    "provider": "html-extractor-wasm"
  }
}
```

Errors use a stable shape:

```json
{
  "error": {
    "code": "unsupported",
    "message": "The webpage could not be extracted."
  }
}
```
