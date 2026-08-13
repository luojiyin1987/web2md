import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  extractWebpage,
  ExtractionError,
  type ExtractionResult,
} from './lib/extraction'

type ConversionState = 'idle' | 'loading' | 'success' | 'error'

function markdownFilename(result: ExtractionResult): string {
  let fallback = 'webpage'

  try {
    fallback = new URL(result.metadata.sourceUrl).hostname || fallback
  } catch {
    // Keep the generic fallback when sourceUrl is not parseable.
  }

  const raw = result.metadata.title?.trim() || fallback
  const safe = raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100)

  return `${safe || 'webpage'}.md`
}

export default function App() {
  const [url, setUrl] = useState('')
  const [state, setState] = useState<ConversionState>('idle')
  const [result, setResult] = useState<ExtractionResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [copied, setCopied] = useState(false)

  async function runExtraction(targetUrl: string) {
    setState('loading')
    setResult(null)
    setErrorMessage('')
    setCopied(false)

    try {
      const nextResult = await extractWebpage(targetUrl)
      setResult(nextResult)
      setState('success')
    } catch (error) {
      if (error instanceof ExtractionError) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('Something went wrong while extracting this webpage.')
      }
      setState('error')
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runExtraction(url)
  }

  async function copyMarkdown() {
    if (!result) return

    try {
      await navigator.clipboard.writeText(result.markdown)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  function downloadMarkdown() {
    if (!result) return

    const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' })
    const objectUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = markdownFilename(result)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(objectUrl)
  }

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">web2md</p>
        <h1 id="page-title">Webpage → Clean Markdown</h1>
        <p className="lede">
          Turn an article or webpage into clean Markdown you can copy, save,
          or feed into your own tools.
        </p>

        <form className="converter" onSubmit={handleSubmit} aria-busy={state === 'loading'}>
          <label htmlFor="url">Webpage URL</label>
          <div className="inputRow">
            <input
              id="url"
              name="url"
              type="url"
              inputMode="url"
              placeholder="https://example.com/article"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              disabled={state === 'loading'}
              required
            />
            <button type="submit" disabled={state === 'loading'}>
              {state === 'loading' ? 'Converting…' : 'Convert'}
            </button>
          </div>
          <p className="hint">Public HTTP(S) webpages only. Login-protected pages may not be extractable.</p>
        </form>
      </section>

      <section className="result" aria-label="Conversion result">
        <div className="resultHeader">
          <h2>Markdown</h2>
          <div className="resultActions">
            <button
              className="secondaryButton"
              type="button"
              onClick={downloadMarkdown}
              disabled={!result}
            >
              Download .md
            </button>
            <button type="button" onClick={copyMarkdown} disabled={!result}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        {state === 'idle' && (
          <div className="emptyState">
            <p>Your cleaned Markdown will appear here.</p>
            <span>Paste a public webpage URL above to get started.</span>
          </div>
        )}

        {state === 'loading' && (
          <div className="statusState" role="status" aria-live="polite">
            <p>Extracting webpage…</p>
            <span>This can take several seconds on larger or JavaScript-heavy pages.</span>
          </div>
        )}

        {state === 'error' && (
          <div className="errorState" role="alert">
            <p>Couldn&apos;t extract this webpage.</p>
            <span>{errorMessage}</span>
            <button
              className="secondaryButton retryButton"
              type="button"
              onClick={() => void runExtraction(url)}
            >
              Retry
            </button>
          </div>
        )}

        {state === 'success' && result && (
          <div className="resultBody">
            <div className="metadata" aria-label="Extraction metadata">
              {result.metadata.title && <strong>{result.metadata.title}</strong>}
              <span>{result.metadata.sourceUrl}</span>
              {result.metadata.wordCount !== undefined && (
                <span>{result.metadata.wordCount.toLocaleString()} words</span>
              )}
              {result.metadata.provider && <span>via {result.metadata.provider}</span>}
            </div>
            <pre className="markdownOutput">{result.markdown}</pre>
          </div>
        )}
      </section>
    </main>
  )
}
