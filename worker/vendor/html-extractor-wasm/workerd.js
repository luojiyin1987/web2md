import * as imports from './html_extractor_wasm_bg.js'
import wasmModule from './html_extractor_wasm_bg.wasm'

const instance = new WebAssembly.Instance(wasmModule, {
  './html_extractor_wasm_bg.js': imports,
})

imports.__wbg_set_wasm(instance.exports)
instance.exports.__wbindgen_start()

export { extract, version } from './html_extractor_wasm_bg.js'
