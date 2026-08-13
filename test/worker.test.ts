import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import('../worker/index')
    }
  }
}

type ErrorPayload = {
  error: {
    code: string
    message: string
  }
}

type SuccessPayload = {
  markdown: string
  metadata: {
    sourceUrl: string
    provider: string
  }
}

const API_URL = 'https://worker.example/api/extract'

function extractionRequest(url: string): Request {
  return new Request(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  })
}

async function extract(url: string): Promise<Response> {
  return exports.default.fetch(extractionRequest(url))
}

function htmlResponse(html: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'text/html; charset=utf-8')
  return new Response(html, { ...init, headers })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('public URL validation', () => {
  it.each([
    'http://127.0.0.1/',
    'http://10.0.0.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
  ])('rejects %s', async (url) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const response = await extract(url)
    const payload = await response.json<ErrorPayload>()

    expect(response.status).toBe(400)
    expect(payload.error.code).toBe('invalid_url')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('allows a public IPv4 address', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      htmlResponse('<main><h1>Public page</h1><p>Readable content.</p></main>'),
    )

    const response = await extract('https://93.184.216.34/article')
    const payload = await response.json<SuccessPayload>()

    expect(response.status).toBe(200)
    expect(payload.markdown).toContain('Public page')
    expect(fetchSpy).toHaveBeenCalledWith('https://93.184.216.34/article', {
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9',
        'user-agent': 'web2md/0.1 (+https://github.com/luojiyin1987/web2md)',
      },
      redirect: 'manual',
    })
  })
})

describe('redirect handling', () => {
  it('follows a public redirect', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy
      .mockImplementationOnce(async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://public.example/final' },
        }),
      )
      .mockImplementationOnce(async () =>
        htmlResponse('<main><h1>Redirected page</h1><p>Readable content.</p></main>'),
      )

    const response = await extract('https://public.example/start')
    const payload = await response.json<SuccessPayload>()

    expect(response.status).toBe(200)
    expect(payload.metadata.sourceUrl).toBe('https://public.example/final')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('rejects a redirect to a private address', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://[::ffff:127.0.0.1]/' },
      }),
    )

    const response = await extract('https://public.example/start')
    const payload = await response.json<ErrorPayload>()

    expect(response.status).toBe(400)
    expect(payload.error.code).toBe('invalid_url')
  })

  it('rejects more than five redirects', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const current = new URL(input instanceof Request ? input.url : input.toString())
      const index = Number(current.searchParams.get('redirect') ?? '0')

      return new Response(null, {
        status: 302,
        headers: { location: `https://public.example/?redirect=${index + 1}` },
      })
    })

    const response = await extract('https://public.example/?redirect=0')
    const payload = await response.json<ErrorPayload>()

    expect(response.status).toBe(502)
    expect(payload.error.code).toBe('fetch_failed')
    expect(fetchSpy).toHaveBeenCalledTimes(6)
  })

  it('does not treat 304 as a redirect', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(null, { status: 304, headers: { location: '/other' } }),
    )

    const response = await extract('https://public.example/start')
    const payload = await response.json<ErrorPayload>()

    expect(response.status).toBe(502)
    expect(payload.error.code).toBe('fetch_failed')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('maps a malformed redirect URL to fetch_failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://[invalid' },
      }),
    )

    const response = await extract('https://public.example/start')
    const payload = await response.json<ErrorPayload>()

    expect(response.status).toBe(502)
    expect(payload.error.code).toBe('fetch_failed')
  })
})

describe('HTML response handling', () => {
  it('rejects a non-HTML response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('plain text', {
        headers: { 'content-type': 'text/plain' },
      }),
    )

    const response = await extract('https://public.example/plain')
    const payload = await response.json<ErrorPayload>()

    expect(response.status).toBe(422)
    expect(payload.error.code).toBe('unsupported')
  })

  it('rejects HTML larger than 2 MiB', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      htmlResponse('', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } }),
    )

    const response = await extract('https://public.example/large')
    const payload = await response.json<ErrorPayload>()

    expect(response.status).toBe(422)
    expect(payload.error.code).toBe('unsupported')
  })

  it('stops a streamed HTML response after 2 MiB', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const chunk = new Uint8Array(1024 * 1024)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk)
          controller.enqueue(chunk)
          controller.enqueue(new Uint8Array([0]))
          controller.close()
        },
      })

      return new Response(body, { headers: { 'content-type': 'text/html' } })
    })

    const response = await extract('https://public.example/streamed-large')
    const payload = await response.json<ErrorPayload>()

    expect(response.status).toBe(422)
    expect(payload.error.code).toBe('unsupported')
  })

  it('extracts Markdown from valid HTML', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      htmlResponse('<article><h1>Test title</h1><p>Test paragraph.</p></article>'),
    )

    const response = await extract('https://public.example/article')
    const payload = await response.json<SuccessPayload>()

    expect(response.status).toBe(200)
    expect(payload.markdown).toContain('Test title')
    expect(payload.markdown).toContain('Test paragraph.')
    expect(payload.metadata.provider).toBe('html-extractor-wasm')
  })

  it('rejects HTML without readable content', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      htmlResponse('<html><body></body></html>'),
    )

    const response = await extract('https://public.example/empty')
    const payload = await response.json<ErrorPayload>()

    expect(response.status).toBe(422)
    expect(payload.error.code).toBe('unsupported')
  })
})
