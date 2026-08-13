# web2md

Convert webpages into clean Markdown.

## Development

```bash
pnpm install
pnpm dev
```

## Extraction API contract

The frontend uses a provider-neutral endpoint so extraction backends can change without coupling the UI to a specific service.

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
    "pageType": "article",
    "provider": "direct"
  }
}
```

Errors use a stable shape:

```json
{
  "error": {
    "code": "blocked",
    "message": "The website blocked automated access."
  }
}
```

The server implementation of `/api/extract` is intentionally kept separate from the frontend contract so direct extraction and Firecrawl fallback can be added independently.
