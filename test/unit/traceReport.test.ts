import { expect } from 'chai'
import {
  createTraceReportUri,
  findTraceReportTargets,
} from '../../packages/extension/src/traceReport'

describe('trace reports', () => {
  it('finds tests with browser trace artifacts', () => {
    const targets = findTraceReportTargets('api', '/root/.vitest/index.html', [
      {
        id: 'file-id',
        type: 'suite',
        tasks: [
          {
            id: 'suite-id',
            type: 'suite',
            tasks: [
              {
                id: 'trace-test-id',
                type: 'test',
                artifacts: [{ type: 'internal:browserTrace' }],
              },
              {
                id: 'regular-test-id',
                type: 'test',
                artifacts: [],
              },
            ],
          },
        ],
      } as any,
    ])

    expect(targets).to.deep.equal([
      {
        apiId: 'api',
        reportPath: '/root/.vitest/index.html',
        fileId: 'file-id',
        testId: 'trace-test-id',
      },
    ])
  })

  it('creates a URL that opens the first trace step', () => {
    const uri = createTraceReportUri({
      apiId: 'api',
      reportPath: '/root/.vitest/index.html',
      fileId: 'file-id',
      testId: 'test-id',
    })

    expect(uri.fsPath.replaceAll('\\', '/')).to.equal('/root/.vitest/index.html')
    expect(Object.fromEntries(new URLSearchParams(uri.fragment.slice(2)))).to.deep.equal({
      file: 'file-id',
      view: 'editor',
      test: 'test-id',
      traceStep: '0',
    })
  })
})
