import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { compatibilityDate: '2026-08-11' },
    }),
  ],
  test: {
    include: ['test/worker.test.ts'],
  },
})
