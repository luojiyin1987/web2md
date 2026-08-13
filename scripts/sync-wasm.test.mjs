import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import test from 'node:test'

const scriptPath = resolve('scripts/sync-wasm.mjs')

test('prints usage help', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--help'])

  assert.equal(result.status, 0, result.stderr.toString())
  assert.match(result.stdout.toString(), /^Usage:/)
  assert.match(result.stdout.toString(), /--source <directory>/)
})

test('rejects an unknown command', () => {
  const result = spawnSync(process.execPath, [scriptPath, 'unknown'])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr.toString(), /command must be build or check/)
})
