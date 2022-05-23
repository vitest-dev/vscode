import { workspace } from 'vscode'
export const extensionId = 'zxch3n.vitest-explorer'

export function getConfig() {
  const config = workspace.getConfiguration('vitest')
  return {
    env: config.get('nodeEnv') as null | Record<string, string>,
    commandLine: (config.get('commandLine') || undefined) as string | undefined,
    include: config.get('include') as string[],
    exclude: config.get('exclude') as string[],
    enable: config.get('enable') as boolean,
    showFailMessages: config.get('showFailMessages') as boolean,
  }
}
