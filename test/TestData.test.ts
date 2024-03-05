import * as path from 'node:path'
import * as vscode from 'vscode'
import { expect } from 'chai'
import { TestCase, TestDescribe, TestFile } from '../src/TestData'

describe('TestData', () => {
  const ctrl = vscode.tests.createTestController('mocha', 'Vitest')
  describe('TestFile', () => {
    it('updateFromDisk', async () => {
      const filepath = path.resolve(__dirname, './testdata/discover/00_simple.ts')
      const testItem = ctrl.createTestItem(
        filepath,
        path.basename(filepath),
        vscode.Uri.file(filepath),
      )
      const file = new TestFile(testItem)
      await file.updateFromDisk(ctrl)

      expect(file.item.error).to.equal(undefined)
      expect(file.resolved).to.equal(true)
      expect(file.getFilePath()).to.equal(filepath)

      expect(file.children.length).to.equal(1)
      const [describe] = file.children
      if (!(describe instanceof TestDescribe))
        throw new Error('not a describe')

      expect(describe.name).to.equal('describe')
      expect(describe.getFilePath()).to.equal(filepath)
      expect(describe.nameResolver.asVitestArgs()).to.equal('^\\s?describe')
      expect(describe.nameResolver.asFullMatchPattern()).to.equal('^\\s?describe$')

      expect(describe.children.length).to.equal(2)
      const [test, eachTest] = describe.children
      if (!(test instanceof TestCase) || !(eachTest instanceof TestCase))
        throw new Error('not a test')

      expect(test.name).to.equal('test')
      expect(test.index).to.equal(0)
      expect(test.getFilePath()).to.equal(filepath)
      expect(test.nameResolver.asVitestArgs()).to.equal('^\\s?describe test$')
      expect(test.nameResolver.asFullMatchPattern()).to.equal('^\\s?describe test$')

      expect(eachTest.name).to.equal('test %i')
      expect(eachTest.isEach).to.equal(true)
      expect(eachTest.index).to.equal(1)
      expect(eachTest.getFilePath()).to.equal(filepath)
      expect(eachTest.nameResolver.asVitestArgs()).to.equal('^\\s?describe test \\d+?$')
      expect(eachTest.nameResolver.asFullMatchPattern()).to.equal('^\\s?describe test \\d+?$')
    })
  })
})
