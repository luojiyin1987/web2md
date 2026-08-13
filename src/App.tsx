import { FormEvent, useState } from 'react'

export default function App() {
  const [url, setUrl] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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

        <form className="converter" onSubmit={handleSubmit}>
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
              required
            />
            <button type="submit">Convert</button>
          </div>
          <p className="hint">Extraction support will be added in the next PR.</p>
        </form>
      </section>

      <section className="result" aria-label="Conversion result">
        <div className="resultHeader">
          <h2>Markdown</h2>
          <button type="button" disabled>
            Copy
          </button>
        </div>
        <div className="emptyState">
          <p>Your cleaned Markdown will appear here.</p>
          <span>Paste a public webpage URL above to get started.</span>
        </div>
      </section>
    </main>
  )
}
