# web2md

Convert webpages into clean Markdown.

## Architecture

web2md is a React SPA with a Cloudflare Worker API. The browser calls the provider-neutral `POST /api/extract` endpoint, and the Worker calls Firecrawl's scrape API with `onlyMainContent` enabled to return clean Markdown.

The Firecrawl API key stays in a Cloudflare Worker secret and is never exposed to the browser.

## Development

Install dependencies and create a local Worker secret file:

```bash
pnpm install
cp .dev.vars.example .dev.vars
```

Set `FIRECRAWL_API_KEY` in `.dev.vars`, then run:

```bash
pnpm dev
```

The Cloudflare Vite plugin runs the API inside `workerd`, so local development uses the same runtime model as production.

## Deployment

Store the Firecrawl API key as a Worker secret:

```bash
pnpm exec wrangler secret put FIRECRAWL_API_KEY
```

Then build and deploy the SPA and Worker together:

```bash
pnpm deploy
```

Cloudflare serves the React static assets and routes `/api/*` through the Worker from the same deployment.

## Extraction API contract

```http
POST /api/extract
content-type: application/json

{"url":"https://example.com/article"}
```

Successful responses return Markdown plus optional metadata:

```json
{
  "markdown": "# Example",
  "metadata": {
    "title": "Example",
    "sourceUrl": "https://example.com/article",
    "wordCount": 320,
    "provider": "firecrawl"
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

The browser remains decoupled from Firecrawl so a Worker-compatible direct extractor or another backend can be added later without changing the UI contract.
