import { describe, expect, it } from 'vitest'
import { extractHtml } from '../src/lib/wasm-extractor'

describe('browser WASM extraction', () => {
  it('extracts Markdown from valid HTML', async () => {
    const result = await extractHtml(
      '<article><h1>Test title</h1><p>Test paragraph.</p></article>',
      'https://public.example/article',
    )

    expect(result.markdown).toContain('Test title')
    expect(result.markdown).toContain('Test paragraph.')
  })

  it('reports no readable content for empty HTML', async () => {
    const result = await extractHtml(
      '<html><body></body></html>',
      'https://public.example/empty',
    )

    expect(result.markdown).toBe('')
  })
})
