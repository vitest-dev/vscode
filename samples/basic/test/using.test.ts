import { expect, describe, it } from 'vitest'

(Symbol as any).dispose ??= Symbol('Symbol.dispose');
(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose')

describe('using keyword', () => {
  it('dispose', () => {
    function getDisposableResource() {
      using resource = new SomeDisposableResource()
      return resource
    }

    const resource = getDisposableResource()
    expect(resource.isDisposed).to.equal(true)
  })

  it('asyncDispose', async () => {
    async function getAsyncDisposableResource() {
      await using resource = new SomeAsyncDisposableResource()
      return resource
    }

    const resource = await getAsyncDisposableResource()
    expect(resource.isDisposed).to.equal(true)
  })
})

class SomeDisposableResource implements Disposable {
  public isDisposed = false;

  [Symbol.dispose](): void {
    this.isDisposed = true
  }
}

class SomeAsyncDisposableResource implements AsyncDisposable {
  public isDisposed = false

  async [Symbol.asyncDispose](): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    this.isDisposed = true
  }
}
