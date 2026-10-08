import { resolve } from 'node:path'
import * as vscode from 'vscode'
import { expect } from 'chai'
import type { VitestProcessAPI } from '../../packages/extension/src/apiProcess'
import { TransformSchemaProvider } from '../../packages/extension/src/schemaProvider'
import { TagsManager } from '../../packages/extension/src/tagsManager'
import { TestTree } from '../../packages/extension/src/testTree'

describe('TestTree', () => {
  it('adds every config tag to a shared test file', () => {
    const controller = vscode.tests.createTestController('test-tree', 'Vitest')
    const loader = controller.createTestItem('loader', 'Loading')
    const schemaProvider = new TransformSchemaProvider(async () => null)
    const tree = new TestTree(controller, loader, new TagsManager(), schemaProvider)
    const root = resolve(__dirname, '../..')
    const workspaceFolder = {
      uri: vscode.Uri.file(root),
      name: 'vscode',
      index: 0,
    }
    const file = resolve(__dirname, 'testTree.test.ts')
    const metadata = { project: '', pool: 'threads' }
    const baseApi = {
      tag: new vscode.TestTag('root:vitest.config.base.ts'),
    } as VitestProcessAPI
    const packageApi = {
      tag: new vscode.TestTag('foo:vitest.config.ts'),
    } as VitestProcessAPI

    tree.reset([workspaceFolder])
    const item = tree.getOrCreateFileTestItem(baseApi, metadata, file)
    const cachedItem = tree.getOrCreateFileTestItem(packageApi, metadata, file)

    expect(cachedItem).to.equal(item)
    expect(cachedItem.tags.map((tag) => tag.id)).to.deep.equal([
      'root:vitest.config.base.ts',
      'foo:vitest.config.ts',
    ])

    tree.dispose()
    schemaProvider.dispose()
    controller.dispose()
  })
})
