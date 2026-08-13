# web2md

Convert public webpages into clean Markdown.

## Architecture

web2md is a React SPA with a Cloudflare Worker API.
The browser calls `POST /api/extract` with a public webpage URL.
The Worker fetches a bounded HTML response and validates each redirect.
The Worker returns the HTML as inert plain text.
The browser runs the vendored `html-extractor` Rust core through WebAssembly.

The Worker limits HTML input to 2 MiB.
It rejects private network URLs and non-HTML responses.
The deployment does not require an external extraction service or API key.
WebAssembly extraction uses the visitor's device CPU.

## Development

Install dependencies and start the Cloudflare Vite development server:

```bash
pnpm install
pnpm dev
```

The Cloudflare Vite plugin runs the API in workerd.
Local development uses the production runtime model.

## Testing

Run the Worker and browser extraction tests:

```bash
pnpm test
```

The Worker tests run inside workerd and mock outbound requests.
The client tests load the production WASM module through Vite.

## CPU use

The Worker does not run the WASM module.
The browser runs HTML parsing and Markdown extraction.
The Worker only validates the URL and transfers the bounded HTML response.
This design removes extraction work from the Workers CPU limit.

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
- the generated type declarations

The client entry is `src/lib/wasm-extractor.ts`.
Vite emits the WASM file as a static browser asset.

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

Successful responses return the fetched HTML as plain text:

```http
HTTP/1.1 200 OK
content-type: text/plain; charset=utf-8
x-content-type-options: nosniff
x-web2md-source-url: https://example.com/article

<!doctype html><html>...</html>
```

The browser does not render this HTML.
It passes the text to the local WASM module.

Errors use a stable shape:

```json
{
  "error": {
    "code": "unsupported",
    "message": "The webpage could not be extracted."
  }
}
```
