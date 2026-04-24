import { resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { expect } from 'chai'
import type { Uri, WorkspaceFolder } from 'vscode'
import { resolveConfigPath, substituteVariables } from '../../packages/extension/src/config'

function mockWorkspaceFolder(fsPath: string, name: string): WorkspaceFolder {
  return {
    uri: { fsPath } as Uri,
    name,
    index: 0,
  }
}

it('correctly resolves ~', () => {
  expect(resolveConfigPath('~/test')).to.equal(resolve(homedir(), 'test'))
})

describe('substituteVariables', () => {
  it('substitutes ${workspaceFolder}', () => {
    const folder = mockWorkspaceFolder('/my/workspace', 'workspace')
    // eslint-disable-next-line no-template-curly-in-string
    expect(substituteVariables('${workspaceFolder}/src', folder)).to.equal('/my/workspace/src')
  })

  it('substitutes ${workspaceFolderBasename}', () => {
    const folder = mockWorkspaceFolder('/my/workspace', 'myproject')
    // eslint-disable-next-line no-template-curly-in-string
    expect(substituteVariables('${workspaceFolderBasename}', folder)).to.equal('myproject')
  })

  it('substitutes ${userHome}', () => {
    // eslint-disable-next-line no-template-curly-in-string
    expect(substituteVariables('${userHome}/projects')).to.equal(`${homedir()}/projects`)
  })

  it('substitutes ${env:NAME}', () => {
    process.env.TEST_VAR_VITEST_EXT = 'hello'
    // eslint-disable-next-line no-template-curly-in-string
    expect(substituteVariables('${env:TEST_VAR_VITEST_EXT}/path')).to.equal('hello/path')
    delete process.env.TEST_VAR_VITEST_EXT
  })

  it('substitutes ${pathSeparator}', () => {
    // eslint-disable-next-line no-template-curly-in-string
    expect(substituteVariables('foo${pathSeparator}bar')).to.equal(`foo${sep}bar`)
  })

  it('substitutes multiple occurrences', () => {
    const folder = mockWorkspaceFolder('/ws', 'myws')
    // eslint-disable-next-line no-template-curly-in-string
    expect(
      substituteVariables('${workspaceFolder}/a/${workspaceFolderBasename}/b', folder),
    ).to.equal('/ws/a/myws/b')
  })

  it('leaves unrecognized variables unchanged', () => {
    // eslint-disable-next-line no-template-curly-in-string
    expect(substituteVariables('${unknown}/path')).to.equal('${unknown}/path')
  })
})
