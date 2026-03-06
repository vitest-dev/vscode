export interface ExtensionWorkerProcess {
  closed: boolean
  onExit: (listener: (code: number | null) => void) => () => void
}
