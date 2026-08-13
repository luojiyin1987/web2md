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

      <section className="seoContent" aria-labelledby="about-web2md">
        <div className="seoIntro">
          <p className="eyebrow">About the tool</p>
          <h2 id="about-web2md">Convert webpages to Markdown without the page clutter</h2>
          <p>
            Web2MD is a free online webpage-to-Markdown converter for public URLs. It extracts the
            readable content from an article or webpage and turns it into clean Markdown that is
            easier to save, edit, search, or pass to other tools.
          </p>
        </div>

        <div className="seoGrid">
          <article>
            <h3>Useful for notes and archives</h3>
            <p>
              Save articles as portable <code>.md</code> files for Markdown editors, personal notes,
              documentation, or long-term reference without keeping the original page layout.
            </p>
          </article>

          <article>
            <h3>Cleaner input for AI tools</h3>
            <p>
              Convert a webpage into structured text before using it with LLMs, research workflows,
              retrieval pipelines, or other tools that work better with Markdown than raw HTML.
            </p>
          </article>

          <article>
            <h3>Focus on the readable content</h3>
            <p>
              Strip away navigation, page chrome, and other surrounding elements so the resulting
              Markdown is easier to read, copy, process, and reuse.
            </p>
          </article>
        </div>

        <div className="howItWorks" aria-labelledby="how-it-works">
          <h2 id="how-it-works">How to convert a webpage to Markdown</h2>
          <ol>
            <li>Paste the URL of a public webpage or article.</li>
            <li>Select Convert and let Web2MD extract the readable content.</li>
            <li>Copy the Markdown or download the result as a <code>.md</code> file.</li>
          </ol>
        </div>
      </section>
    </main>
  )
}
