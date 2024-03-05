import { describe } from 'vitest'

const a = 10
describe(`x ${a} sdf`, () => {
  class B {
    // @ts-ignore
    constructor(@Inject(A) public a: string) {}
  }
})
