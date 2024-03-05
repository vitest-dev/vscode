import { describe } from 'vitest'

interface Person {
  name: string
  age: number
}
describe('satisfies keyword', () => {
  ({
    name: 'test',
    age: 20,
  }) satisfies Person
})
