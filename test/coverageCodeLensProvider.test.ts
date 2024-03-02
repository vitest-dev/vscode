import * as vscode from 'vscode';
import * as fs from 'fs'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { CoverageCodeLensProvider } from '../src/coverage/coverageCodeLensProvider'

describe('coverageCodeLensProvider', () => {
  let coverageCodeLensProvider: CoverageCodeLensProvider;

  beforeEach(() => {
    coverageCodeLensProvider = new CoverageCodeLensProvider();
    vi.mock('vscode', () => {
      return {
        workspace: {
          workspaceFolders: [{ uri: { fsPath: 'workspace-root' } }],
        },
        Range: vi.fn().mockImplementation((startLine, startCharacter, endLine, endCharacter) => ({
          start: { line: startLine, character: startCharacter },
          end: { line: endLine, character: endCharacter },
        })),
        CodeLens: vi.fn().mockImplementation((range, command) => ({
          range,
          command: command || '',
          isResolved: false,
          title: ''
        })),
      }
    });

    vi.mock('fs', () => {
      return {
        existsSync: vi.fn(),
        promises: {
          readFile: vi.fn(),
        },
      }
    });

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify({
      'file-name': {
        s: { 0: 1, 1: 0}, // 50% statement
        f: { 0: 1, 1: 1}, // 100% function
        b: { 0: 0, 1: 0, 2: 1}, // 33.33% branch
      }
    }));
  });

  it('should return an empty array when there is no coverage file', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await coverageCodeLensProvider.provideCodeLenses({
      fileName: 'file-name',
    } as unknown as vscode.TextDocument, {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    });

    expect(result).toEqual([])
  })

  it('should return code lens with expected title', async () => {
    await coverageCodeLensProvider.provideCodeLenses({
      fileName: 'file-name',
    } as unknown as vscode.TextDocument, {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    });

    expect(vi.mocked(vscode.CodeLens)).toHaveBeenCalledWith(
    expect.any(Object),
    expect.objectContaining({
      title: 'functions: 100%, statements: 50%, branches: 33.33%',
      command: ''
    }));
  });

  it('should return 0% coverage when totalItems is 0', async () => {
    await coverageCodeLensProvider.provideCodeLenses({
      fileName: 'file-name',
    } as unknown as vscode.TextDocument, {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    });

    expect(vi.mocked(vscode.CodeLens)).toHaveBeenCalledWith(
    expect.any(Object),
    expect.objectContaining({
      title: 'functions: 100%, statements: 50%, branches: 33.33%',
      command: ''
    }));
  });
})
