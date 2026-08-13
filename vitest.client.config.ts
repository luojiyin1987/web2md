import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/client-extractor.test.ts'],
  },
})
