declare const ts: true

// @ts-expect-error this is just a test
throw new Error('This file should not be included by default.')
