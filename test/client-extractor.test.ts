import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractHtml } from '../src/lib/wasm-extractor'
import type {
  WasmExtractionRequest,
  WasmExtractionResponse,
} from '../src/lib/wasm-extractor-protocol'
import { extractHtmlInWorker } from '../src/lib/wasm-extractor-runtime'
import type { ExtractResult } from '../worker/vendor/html-extractor-wasm/html_extractor_wasm.js'

const workerResult: ExtractResult = {
  markdown: '# Worker result',
  pageType: 'article',
  extractionQuality: 1,
}

class MockWorker {
  static latest: MockWorker | undefined

  readonly options: WorkerOptions | undefined
  postedRequest: WasmExtractionRequest | undefined
  private messageListener:
    | ((event: MessageEvent<WasmExtractionResponse>) => void)
    | undefined

  constructor(_url: string | URL, options?: WorkerOptions) {
    this.options = options
    MockWorker.latest = this
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message' && typeof listener === 'function') {
      this.messageListener = listener as (event: MessageEvent<WasmExtractionResponse>) => void
    }
  }

  postMessage(message: unknown): void {
    const request = message as WasmExtractionRequest
    this.postedRequest = request

    queueMicrotask(() => {
      const response: WasmExtractionResponse = {
        id: request.id,
        ok: true,
        result: workerResult,
      }
      this.messageListener?.({ data: response } as MessageEvent<WasmExtractionResponse>)
    })
  }

  terminate(): void {}
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('browser WASM extraction worker', () => {
  it('runs extraction through a module worker', async () => {
    vi.stubGlobal('Worker', MockWorker)

    const result = await extractHtml(
      '<article><h1>Worker title</h1></article>',
      'https://public.example/worker',
    )

    expect(result).toEqual(workerResult)
    expect(MockWorker.latest?.options).toEqual({
      type: 'module',
      name: 'web2md-wasm-extractor',
    })
    expect(MockWorker.latest?.postedRequest).toMatchObject({
      html: '<article><h1>Worker title</h1></article>',
      url: 'https://public.example/worker',
    })
  })
})

describe('WASM extraction runtime', () => {
  it('extracts Markdown from valid HTML', async () => {
    const result = await extractHtmlInWorker(
      '<article><h1>Test title</h1><p>Test paragraph.</p></article>',
      'https://public.example/article',
    )

    expect(result.markdown).toContain('Test title')
    expect(result.markdown).toContain('Test paragraph.')
  })

  it('reports no readable content for empty HTML', async () => {
    const result = await extractHtmlInWorker(
      '<html><body></body></html>',
      'https://public.example/empty',
    )

    expect(result.markdown).toBe('')
  })
})
