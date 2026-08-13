import type { ExtractResult } from '../../worker/vendor/html-extractor-wasm/html_extractor_wasm_bg.js'

export interface WasmExtractionRequest {
  id: number
  html: string
  url: string
}

export type WasmExtractionResponse =
  | { id: number; ok: true; result: ExtractResult }
  | { id: number; ok: false; error: string }
