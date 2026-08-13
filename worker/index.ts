import {
  extract,
  type ExtractResult as WasmExtractResult,
} from './vendor/html-extractor-wasm/workerd.js'

type JsonRecord = Record<string, unknown>

type ExtractionErrorCode =
  | 'invalid_url'
  | 'fetch_failed'
  | 'blocked'
  | 'unsupported'
  | 'server_error'

const MAX_API_REQUEST_BYTES = 8 * 1024
const MAX_HTML_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 5

class ExtractionFailure extends Error {
  readonly code: ExtractionErrorCode
  readonly status: number

  constructor(code: ExtractionErrorCode, message: string, status: number) {
    super(message)
    this.name = 'ExtractionFailure'
    this.code = code
    this.status = status
  }
}

class BodyTooLargeError extends Error {}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  })
}

function errorResponse(code: ExtractionErrorCode, message: string, status: number): Response {
  return json({ error: { code, message } }, { status })
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '')

  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') {
    return true
  }

  if (
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe8') ||
    host.startsWith('fe9') ||
    host.startsWith('fea') ||
    host.startsWith('feb')
  ) {
    return host.includes(':')
  }

  const parts = host.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false
  }

  const octets = parts.map(Number)
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    return false
  }

  const [a, b] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function normalizePublicUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ExtractionFailure('invalid_url', 'Enter a webpage URL.', 400)
  }

  if (value.length > 4096) {
    throw new ExtractionFailure('invalid_url', 'The webpage URL is too long.', 400)
  }

  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new ExtractionFailure('invalid_url', 'Enter a valid webpage URL.', 400)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ExtractionFailure('invalid_url', 'Only HTTP and HTTPS URLs are supported.', 400)
  }

  if (url.username || url.password) {
    throw new ExtractionFailure(
      'invalid_url',
      'URLs containing credentials are not supported.',
      400,
    )
  }

  if (isPrivateOrLocalHostname(url.hostname)) {
    throw new ExtractionFailure(
      'invalid_url',
      'Private and local network URLs are not supported.',
      400,
    )
  }

  return url.toString()
}

function countWords(markdown: string): number | undefined {
  const text = markdown.trim()
  return text ? text.split(/\s+/u).length : undefined
}

async function readBoundedText(
  source: { headers: Headers; body: ReadableStream<Uint8Array> | null },
  maxBytes: number,
): Promise<string> {
  const contentLength = source.headers.get('content-length')
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength)
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new BodyTooLargeError()
    }
  }

  if (!source.body) {
    return ''
  }

  const reader = source.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    totalBytes += value.byteLength
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new BodyTooLargeError()
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder().decode(bytes)
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400
}

function validateHtmlResponse(response: Response): void {
  if (!response.ok) {
    const blocked = response.status === 401 || response.status === 403
    throw new ExtractionFailure(
      blocked ? 'blocked' : 'fetch_failed',
      blocked
        ? 'The webpage blocked the extraction request.'
        : `The webpage returned HTTP ${response.status}.`,
      blocked ? 422 : 502,
    )
  }

  const contentType = response.headers.get('content-type')
  if (!contentType) return

  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase()
  if (mediaType !== 'text/html' && mediaType !== 'application/xhtml+xml') {
    throw new ExtractionFailure(
      'unsupported',
      'The URL did not return an HTML document.',
      422,
    )
  }
}

async function fetchHtml(initialUrl: string): Promise<{ html: string; finalUrl: string }> {
  let currentUrl = initialUrl

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response: Response
    try {
      response = await fetch(currentUrl, {
        headers: {
          accept: 'text/html,application/xhtml+xml;q=0.9',
        },
        redirect: 'manual',
      })
    } catch {
      throw new ExtractionFailure(
        'fetch_failed',
        'Could not fetch the webpage. Try again.',
        502,
      )
    }

    if (isRedirect(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()

      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new ExtractionFailure(
          'fetch_failed',
          'The webpage returned too many redirects.',
          502,
        )
      }

      currentUrl = normalizePublicUrl(new URL(location, currentUrl).toString())
      continue
    }

    validateHtmlResponse(response)

    let html: string
    try {
      html = await readBoundedText(response, MAX_HTML_BYTES)
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        throw new ExtractionFailure(
          'unsupported',
          'The webpage is too large to process.',
          422,
        )
      }
      throw error
    }

    return { html, finalUrl: currentUrl }
  }

  throw new ExtractionFailure('fetch_failed', 'The webpage could not be fetched.', 502)
}

function extractMarkdown(html: string, url: string): WasmExtractResult {
  try {
    return extract(html, {
      url,
      includeLinks: true,
      includeTables: true,
      includeImages: false,
      includeMetadata: true,
      maxInputSize: MAX_HTML_BYTES,
    })
  } catch (error) {
    console.error(
      JSON.stringify({
        message: 'WASM extraction failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    throw new ExtractionFailure('server_error', 'The webpage could not be extracted.', 500)
  }
}

async function handleExtract(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json(
      { error: { code: 'unsupported', message: 'Use POST for this endpoint.' } },
      { status: 405, headers: { allow: 'POST' } },
    )
  }

  try {
    const requestText = await readBoundedText(request, MAX_API_REQUEST_BYTES)
    const body: unknown = JSON.parse(requestText)
    const requestedUrl = normalizePublicUrl(isRecord(body) ? body.url : undefined)
    const { html, finalUrl } = await fetchHtml(requestedUrl)
    const result = extractMarkdown(html, finalUrl)

    if (!result.markdown.trim()) {
      throw new ExtractionFailure(
        'unsupported',
        result.errorReason ?? 'No readable Markdown content was found.',
        422,
      )
    }

    return json({
      markdown: result.markdown,
      metadata: {
        title: result.metadata?.title,
        sourceUrl: finalUrl,
        wordCount: countWords(result.markdown),
        pageType: result.pageType,
        provider: 'html-extractor-wasm',
      },
    })
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResponse('unsupported', 'The request body is too large.', 413)
    }

    if (error instanceof SyntaxError) {
      return errorResponse('invalid_url', 'Send a JSON body containing a webpage URL.', 400)
    }

    if (error instanceof ExtractionFailure) {
      return errorResponse(error.code, error.message, error.status)
    }

    console.error(
      JSON.stringify({
        message: 'Unhandled extraction error',
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return errorResponse('server_error', 'The webpage could not be extracted.', 500)
  }
}

export default {
  async fetch(request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/extract') {
      return handleExtract(request)
    }

    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler
