import * as path from 'node:path'
import * as vscode from 'vscode'
import { expect } from 'chai'
import { TestCase, TestFile, TestSuite } from '../src/testTreeData'

describe('TestData', () => {
  const ctrl = vscode.tests.createTestController('mocha', 'Vitest')
  describe('TestFile', () => {
    it('getTestNamePattern', async () => {
      const filepath = path.resolve(__dirname, './testdata/discover/00_simple.ts')
      const uri = vscode.Uri.file(filepath)
      const testItem = ctrl.createTestItem(
        filepath,
        path.basename(filepath),
        uri,
      )
      ctrl.items.add(testItem)
      const file = TestFile.register(
        testItem,
        filepath,
        null as any, // not used yet
        '',
      )
      const suiteItem = ctrl.createTestItem(
        `${filepath}_1`,
        'describe',
        uri,
      )
      file.item.children.add(suiteItem)

      const testItem1 = ctrl.createTestItem(
        `${filepath}_1_1`,
        'test',
        uri,
      )

      const testItem2 = ctrl.createTestItem(
        `${filepath}_1_2`,
        'test 1',
        uri,
      )

      const testItem3 = ctrl.createTestItem(
        `${filepath}_1_3`,
        'test 2',
        uri,
      )

      suiteItem.children.add(testItem1)
      suiteItem.children.add(testItem2)
      suiteItem.children.add(testItem3)

      const suite = TestSuite.register(suiteItem, file)

      expect(suite.getTestNamePattern()).to.equal('^\\s?describe')

      const test1 = TestCase.register(testItem1, file)
      const test2 = TestCase.register(testItem2, file)
      const test3 = TestCase.register(testItem3, file)

      expect(test1.item.parent).to.exist

      expect(test1.getTestNamePattern()).to.equal('^\\s?describe test$')
      expect(test2.getTestNamePattern()).to.equal('^\\s?describe test 1$')
      expect(test3.getTestNamePattern()).to.equal('^\\s?describe test 2$')
    })
  })
})
