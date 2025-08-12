
export function add(a: number, b: number) {
  return a + b
}

export function sum(from: number, to: number) {
  return (from + to) * (to - from + 1) / 2
}

export function addError(from: number, to: number) {
  doSomething()
  return add(from, to)
}

function doSomething() {
  throw new Error('Something went wrong');
}
