import { describe, it } from 'vitest'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('console', () => {
  it('basic', () => {
    const variables = ['string', { hello: 'world' }, 1235, /regex/g, true, false, null]
    console.log(variables)
  })

  it('async', async () => {
    console.log('1st')
    await sleep(200)
    console.log('2nd')
    await sleep(200)
    console.log('3rd')
  })
})
