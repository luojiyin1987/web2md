import type {
  WasmExtractionRequest,
  WasmExtractionResponse,
} from './wasm-extractor-protocol'
import { extractHtmlInWorker } from './wasm-extractor-runtime'

type WorkerScope = {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<WasmExtractionRequest>) => void,
  ): void
  postMessage(message: WasmExtractionResponse): void
}

const workerScope = globalThis as unknown as WorkerScope

workerScope.addEventListener('message', (event) => {
  const { id, html, url } = event.data

  void extractHtmlInWorker(html, url)
    .then((result) => {
      workerScope.postMessage({ id, ok: true, result })
    })
    .catch((error: unknown) => {
      workerScope.postMessage({
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    })
})
