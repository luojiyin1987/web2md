import initWasm from '../../worker/vendor/html-extractor-wasm/html_extractor_wasm_bg.wasm?init'
import * as wasmBindings from '../../worker/vendor/html-extractor-wasm/html_extractor_wasm_bg.js'
import type { ExtractResult } from '../../worker/vendor/html-extractor-wasm/html_extractor_wasm_bg.js'

const MAX_HTML_BYTES = 2 * 1024 * 1024

let initialization: Promise<void> | undefined

function initializeWasm(): Promise<void> {
  if (!initialization) {
    initialization = initWasm({
      './html_extractor_wasm_bg.js': wasmBindings,
    }).then((instance) => {
      wasmBindings.__wbg_set_wasm(instance.exports)

      const start = instance.exports.__wbindgen_start
      if (typeof start !== 'function') {
        throw new Error('The WASM module does not export __wbindgen_start.')
      }
      start()
    })
  }

  return initialization
}

export async function extractHtmlInWorker(
  html: string,
  url: string,
): Promise<ExtractResult> {
  await initializeWasm()

  return wasmBindings.extract(html, {
    url,
    includeLinks: true,
    includeTables: true,
    includeImages: false,
    includeMetadata: true,
    maxInputSize: MAX_HTML_BYTES,
  })
}
