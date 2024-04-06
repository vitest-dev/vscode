import type { Vitest as VitestCore } from 'vitest'
import type { Vitest } from './vitest'

export class VitestDebugger {
  private _enabled = false

  constructor(
    private ctx: VitestCore,
    private vitest: Vitest,
  ) {
    Object.defineProperty(ctx.config, 'inspect', {
      get: () => {
        return this.enabled
      },
    })
  }

  public get enabled() {
    return this._enabled && !this.vitest.collecting
  }

  public start(_port: number) {
    this._enabled = true
  }

  public stop() {
    this._enabled = false
  }
}
