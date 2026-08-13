import type { ExtractResult } from '../../worker/vendor/html-extractor-wasm/html_extractor_wasm.js'
import type {
  WasmExtractionRequest,
  WasmExtractionResponse,
} from './wasm-extractor-protocol'

type PendingRequest = {
  resolve(result: ExtractResult): void
  reject(error: Error): void
}

let worker: Worker | undefined
let nextRequestId = 1
const pendingRequests = new Map<number, PendingRequest>()

function failPendingRequests(error: Error): void {
  const currentWorker = worker
  worker = undefined
  currentWorker?.terminate()

  for (const pending of pendingRequests.values()) {
    pending.reject(error)
  }
  pendingRequests.clear()
}

function getWorker(): Worker {
  if (worker) return worker

  const nextWorker = new Worker(new URL('./wasm-extractor.worker.ts', import.meta.url), {
    type: 'module',
    name: 'web2md-wasm-extractor',
  })

  nextWorker.addEventListener('message', (event: MessageEvent<WasmExtractionResponse>) => {
    const pending = pendingRequests.get(event.data.id)
    if (!pending) return

    pendingRequests.delete(event.data.id)
    if (event.data.ok) {
      pending.resolve(event.data.result)
    } else {
      pending.reject(new Error(event.data.error))
    }
  })

  nextWorker.addEventListener('error', (event) => {
    event.preventDefault()
    failPendingRequests(new Error(event.message || 'The WASM extraction worker failed.'))
  })

  nextWorker.addEventListener('messageerror', () => {
    failPendingRequests(new Error('The WASM extraction worker returned an invalid message.'))
  })

  worker = nextWorker
  return nextWorker
}

export function extractHtml(html: string, url: string): Promise<ExtractResult> {
  const request: WasmExtractionRequest = {
    id: nextRequestId,
    html,
    url,
  }
  nextRequestId += 1

  return new Promise((resolve, reject) => {
    try {
      const currentWorker = getWorker()
      pendingRequests.set(request.id, { resolve, reject })
      currentWorker.postMessage(request)
    } catch (error) {
      pendingRequests.delete(request.id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
