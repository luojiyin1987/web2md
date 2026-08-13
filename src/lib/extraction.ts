export type ExtractionErrorCode =
  | 'invalid_url'
  | 'fetch_failed'
  | 'blocked'
  | 'unsupported'
  | 'timeout'
  | 'usage_limit'
  | 'server_error'

export interface ExtractionMetadata {
  title?: string
  sourceUrl: string
  wordCount?: number
  pageType?: string
  provider?: string
}

export interface ExtractionResult {
  markdown: string
  metadata: ExtractionMetadata
}

export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode
  readonly status?: number

  constructor(code: ExtractionErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'ExtractionError'
    this.code = code
    this.status = status
  }
}

type JsonRecord = Record<string, unknown>

const DEFAULT_TIMEOUT_MS = 40_000

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toErrorCode(value: unknown): ExtractionErrorCode {
  switch (value) {
    case 'invalid_url':
    case 'fetch_failed':
    case 'blocked':
    case 'unsupported':
    case 'timeout':
    case 'usage_limit':
    case 'server_error':
      return value
    default:
      return 'server_error'
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function normalizeWebpageUrl(value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new ExtractionError('invalid_url', 'Enter a webpage URL.')
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new ExtractionError('invalid_url', 'Enter a valid webpage URL.')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ExtractionError('invalid_url', 'Only HTTP and HTTPS URLs are supported.')
  }

  return parsed.toString()
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export async function extractWebpage(
  value: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ExtractionResult> {
  const url = normalizeWebpageUrl(value)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  let timedOut = false

  const abortFromCaller = () => controller.abort()
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })

  const timeoutId = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  let response: Response
  try {
    response = await fetch('/api/extract', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (timedOut) {
        throw new ExtractionError(
          'timeout',
          'The extraction timed out. Try again or use a simpler webpage.',
        )
      }

      throw error
    }

    throw new ExtractionError(
      'fetch_failed',
      'Could not reach the extraction service. Try again.',
    )
  } finally {
    window.clearTimeout(timeoutId)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }

  const payload = await readJson(response)

  if (!response.ok) {
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : null
    const code = toErrorCode(errorPayload?.code)
    const message = optionalString(errorPayload?.message) ?? 'The webpage could not be extracted.'

    throw new ExtractionError(code, message, response.status)
  }

  if (!isRecord(payload) || typeof payload.markdown !== 'string') {
    throw new ExtractionError(
      'server_error',
      'The extraction service returned an invalid response.',
      response.status,
    )
  }

  const metadata = isRecord(payload.metadata) ? payload.metadata : {}

  return {
    markdown: payload.markdown,
    metadata: {
      sourceUrl: optionalString(metadata.sourceUrl) ?? url,
      title: optionalString(metadata.title),
      wordCount: optionalNumber(metadata.wordCount),
      pageType: optionalString(metadata.pageType),
      provider: optionalString(metadata.provider),
    },
  }
}
