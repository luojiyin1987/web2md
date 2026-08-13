interface Env {
  FIRECRAWL_API_KEY?: string
}

type JsonRecord = Record<string, unknown>

type WorkerHandler = {
  fetch(request: Request, env: Env): Promise<Response>
}

const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'
const FIRECRAWL_TIMEOUT_MS = 30_000
const UPSTREAM_FETCH_TIMEOUT_MS = 35_000

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
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

function errorResponse(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, { status })
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '')

  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') {
    return true
  }

  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) {
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
    throw new Error('Enter a webpage URL.')
  }

  if (value.length > 4096) {
    throw new Error('The webpage URL is too long.')
  }

  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Enter a valid webpage URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are supported.')
  }

  if (url.username || url.password) {
    throw new Error('URLs containing credentials are not supported.')
  }

  if (isPrivateOrLocalHostname(url.hostname)) {
    throw new Error('Private and local network URLs are not supported.')
  }

  return url.toString()
}

function countWords(markdown: string): number | undefined {
  const text = markdown.trim()
  if (!text) return undefined
  return text.split(/\s+/u).length
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function upstreamErrorCode(status: number): string {
  if (status === 402) return 'usage_limit'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 400 || status === 422) return 'unsupported'
  return 'server_error'
}

function upstreamErrorMessage(status: number, payload: unknown): string {
  if (status === 402) {
    return 'The Firecrawl usage limit has been reached. Try again after credits reset.'
  }

  if (status === 429) {
    return 'Firecrawl is rate-limiting requests. Try again shortly.'
  }

  if (status === 401 || status === 403) {
    return 'The Firecrawl API key is missing, invalid, or not authorized.'
  }

  if (status === 408 || status === 504) {
    return 'Firecrawl timed out while processing this webpage. Try again.'
  }

  if (isRecord(payload)) {
    const message = optionalString(payload.error) ?? optionalString(payload.message)
    if (message) return message
  }

  if (status >= 500) {
    return 'Firecrawl is temporarily unavailable. Try again later.'
  }

  return 'The webpage could not be extracted.'
}

async function handleExtract(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return json(
      { error: { code: 'unsupported', message: 'Use POST for this endpoint.' } },
      { status: 405, headers: { allow: 'POST' } },
    )
  }

  if (!env.FIRECRAWL_API_KEY) {
    return errorResponse(
      'server_error',
      'The extraction service is not configured. Add FIRECRAWL_API_KEY to .dev.vars or Worker secrets.',
      503,
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('invalid_url', 'Send a JSON body containing a webpage URL.', 400)
  }

  let url: string
  try {
    url = normalizePublicUrl(isRecord(body) ? body.url : undefined)
  } catch (error) {
    return errorResponse(
      'invalid_url',
      error instanceof Error ? error.message : 'Enter a valid webpage URL.',
      400,
    )
  }

  const requestId = crypto.randomUUID()
  const targetHost = new URL(url).hostname
  const startedAt = Date.now()

  console.info('extract:start', { requestId, host: targetHost })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_FETCH_TIMEOUT_MS)

  let upstream: Response
  try {
    upstream = await fetch(FIRECRAWL_SCRAPE_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        onlyCleanContent: false,
        blockAds: true,
        removeBase64Images: true,
        maxAge: 3_600_000,
        timeout: FIRECRAWL_TIMEOUT_MS,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    const durationMs = Date.now() - startedAt

    if (error instanceof Error && error.name === 'AbortError') {
      console.warn('extract:timeout', { requestId, host: targetHost, durationMs })
      return errorResponse(
        'timeout',
        'Firecrawl did not respond in time. Try again.',
        504,
      )
    }

    console.error('extract:fetch-failed', { requestId, host: targetHost, durationMs })
    return errorResponse(
      'fetch_failed',
      'Could not reach Firecrawl. Check your connection and try again.',
      502,
    )
  } finally {
    clearTimeout(timeoutId)
  }

  const payload = await safeJson(upstream)
  const durationMs = Date.now() - startedAt

  console.info('extract:upstream', {
    requestId,
    host: targetHost,
    status: upstream.status,
    durationMs,
  })

  if (!upstream.ok) {
    return errorResponse(
      upstreamErrorCode(upstream.status),
      upstreamErrorMessage(upstream.status, payload),
      upstream.status === 429 || upstream.status === 402 ? 503 : 502,
    )
  }

  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
    console.warn('extract:invalid-response', { requestId, host: targetHost, durationMs })
    return errorResponse(
      'server_error',
      upstreamErrorMessage(upstream.status, payload),
      502,
    )
  }

  const markdown = payload.data.markdown
  if (typeof markdown !== 'string' || markdown.trim().length === 0) {
    console.warn('extract:empty', { requestId, host: targetHost, durationMs })
    return errorResponse(
      'unsupported',
      'No readable Markdown content was found on this webpage.',
      422,
    )
  }

  const metadata = isRecord(payload.data.metadata) ? payload.data.metadata : {}

  console.info('extract:success', {
    requestId,
    host: targetHost,
    durationMs,
    markdownChars: markdown.length,
  })

  return json({
    markdown,
    metadata: {
      title: optionalString(metadata.title),
      sourceUrl:
        optionalString(metadata.sourceURL) ?? optionalString(metadata.url) ?? url,
      wordCount: countWords(markdown),
      provider: 'firecrawl',
    },
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/extract') {
      return handleExtract(request, env)
    }

    return new Response(null, { status: 404 })
  },
} satisfies WorkerHandler
