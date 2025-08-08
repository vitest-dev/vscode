declare module 'vitest' {
  export interface ProvidedContext {
    __vscode: {
      continuousFiles: string[]
      watchEveryFile: boolean
      rerunTriggered: boolean
    }
  }
}

export {}
