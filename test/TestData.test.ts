import * as path from 'node:path'
import * as vscode from 'vscode'
import { expect } from 'chai'
import { TestCase, TestFile, TestFolder, TestSuite, getTestData } from '../src/testTreeData'

describe('TestData', () => {
  const ctrl = vscode.tests.createTestController('mocha', 'Vitest')
  describe('TestFile', () => {
    it('getTestNamePattern', async () => {
      const filepath = path.resolve(__dirname, './testdata/discover/00_simple.ts')
      const uri = vscode.Uri.file(filepath)
      const folderItem = ctrl.createTestItem(
        path.dirname(filepath),
        path.basename(path.dirname(filepath)),
        uri,
      )
      TestFolder.register(folderItem)
      const testItem = ctrl.createTestItem(
        filepath,
        path.basename(filepath),
        uri,
      )
      ctrl.items.add(testItem)
      const file = TestFile.register(
        testItem,
        folderItem,
        filepath,
        null as any, // not used yet
        '',
      )
      const suiteItem = ctrl.createTestItem(
        `${filepath}_1`,
        'describe',
        uri,
      )
      testItem.children.add(suiteItem)

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

      const suite = TestSuite.register(suiteItem, testItem, file)

      expect(suite.getTestNamePattern()).to.equal('^\\s?describe')

      const test1 = TestCase.register(testItem1, suiteItem, file)
      const test2 = TestCase.register(testItem2, suiteItem, file)
      const test3 = TestCase.register(testItem3, suiteItem, file)

      expect(testItem1.parent).to.exist

      expect(test1.getTestNamePattern()).to.equal('^\\s?describe test$')
      expect(test2.getTestNamePattern()).to.equal('^\\s?describe test 1$')
      expect(test3.getTestNamePattern()).to.equal('^\\s?describe test 2$')
    })

    it('throws an error if data was not set', () => {
      expect(() => getTestData({ label: 'invalid test' } as any)).to.throw(/Test data not found for "invalid test"/)
    })
  })
})
