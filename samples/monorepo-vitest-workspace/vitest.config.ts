import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    workspace: [
      'packages/*',
      {
        test: {
          environment: 'happy-dom',
        },
      },
    ]
  }
})
