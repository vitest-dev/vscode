import type {
  CompletionItem,
  Diagnostic,
  InitializeParams,
  InitializeResult,
  TextDocumentPositionParams,
} from 'vscode-languageserver/node'
import {
  CompletionItemKind,
  DiagnosticSeverity,
  DidChangeConfigurationNotification,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
  createConnection,
} from 'vscode-languageserver/node'

import { TextDocument } from 'vscode-languageserver-textdocument'
import type { ParsedNode } from './pure/parsers/parser_nodes'
import { DescribeBlock, ItBlock } from './pure/parsers/parser_nodes'
import parse from './pure/parsers'

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all)

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

let hasConfigurationCapability: boolean = false
let hasWorkspaceFolderCapability: boolean = false
let hasDiagnosticRelatedInformationCapability: boolean = false

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities

  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  )
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  )
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument
    && capabilities.textDocument.publishDiagnostics
    && capabilities.textDocument.publishDiagnostics.relatedInformation
  )

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      completionProvider: {
        resolveProvider: true,
      },
    },
  }
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    }
  }
  return result
})

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(DidChangeConfigurationNotification.type, undefined)
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      connection.console.log('Workspace folder change event received.')
    })
  }
})

// The example settings
interface ExampleSettings {
  maxNumberOfProblems: number
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 }
let globalSettings: ExampleSettings = defaultSettings

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map()

connection.onDidChangeConfiguration((change) => {
  if (hasConfigurationCapability) {
    // Reset all cached document settings
    documentSettings.clear()
  }
  else {
    globalSettings = <ExampleSettings>(
      (change.settings.languageServerExample || defaultSettings)
    )
  }

  // Revalidate all open text documents
  documents.all().forEach(validateTextDocument)
})

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
  if (!hasConfigurationCapability)
    return Promise.resolve(globalSettings)

  let result = documentSettings.get(resource)
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: 'vitestLanguageServer',
    })
    documentSettings.set(resource, result)
  }
  return result
}

// Only keep settings for open documents
documents.onDidClose((e) => {
  documentSettings.delete(e.document.uri)
})

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
  validateTextDocument(change.document)
})

function validateTextDocument(textDocument: TextDocument): void {
  const diagnostics: Diagnostic[] = []
  const text = textDocument.getText()
  function traverse(node: ParsedNode) {
    if (!node.children)
      return
    type NamedBlock = DescribeBlock | ItBlock
    const describeBlocks = new Map<string, NamedBlock[]>()
    const itBlocks = new Map<string, ItBlock[]>()
    const emptyBlocks: NamedBlock[] = []
    const noPlaceholderEachBlocks: NamedBlock[] = []
    function getPosition(node: ParsedNode) {
      if (node.start == null || node.end == null)
        return
      const start = textDocument.positionAt(
        textDocument.offsetAt({
          line: node.start.line - 1,
          character: node.start.column - 1,
        }),
      )
      const end = textDocument.positionAt(
        textDocument.offsetAt({
          line: node.end.line - 1,
          character: node.end.column - 1,
        }),
      )
      return { start, end }
    }
    function groupByName<T extends NamedBlock>(block: T, map: Map<string, T[]>) {
      const name = block.name
      if (!name) {
        emptyBlocks.push(block)
      }
      else {
        const blocks = map.get(name) ?? []
        blocks.push(block)
        map.set(name, blocks)
        if (block.lastProperty === 'each'
          && !name.match(/[%$]/)
        )
          noPlaceholderEachBlocks.push(block)
      }
    }
    for (const child of node.children) {
      if (child instanceof DescribeBlock)
        groupByName(child, describeBlocks)
      else if (child instanceof ItBlock)
        groupByName(child, itBlocks)
    }
    const duplicatedDescribeBlocks = Array.from(describeBlocks.entries()).filter(([_, describeBlocks]) => describeBlocks.length > 1)
    const duplicatedItBlocks = Array.from(itBlocks.entries()).filter(([_, itBlocks]) => itBlocks.length > 1)
    const duplicatedBlocks = [...duplicatedDescribeBlocks, ...duplicatedItBlocks]
    for (const [name, duplication] of duplicatedBlocks) {
      for (const d of duplication) {
        const range = getPosition(d)
        if (range == null)
          continue
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range,
          message: `Duplicated ${d.type} block: '${name}'`,
          source: 'Vitest',
        })
      }
    }
    for (const d of emptyBlocks) {
      const range = getPosition(d)
      if (range == null)
        continue
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range,
        message: `Empty ${d.type} block`,
        source: 'Vitest',
      })
    }
    for (const d of noPlaceholderEachBlocks) {
      const range = getPosition(d)
      if (range == null)
        continue
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range,
        message: `Each block '${d.name}' should have a placeholder`,
        source: 'Vitest',
      })
    }
    for (const child of node.children)
      traverse(child)
  }
  traverse(parse(textDocument.uri, text).root)
  // Send the computed diagnostics to VSCode.
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics })
}

connection.onDidChangeWatchedFiles((_change) => {
  // Monitored files have change in VS Code
  connection.console.log('We received a file change event')
})

// This handler provides the initial list of the completion items.
connection.onCompletion(
  (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    // The pass parameter contains the position of the text document in
    // which code complete got requested. For the example we ignore this
    // info and always provide the same completion items.
    return [
      {
        label: 'TypeScript',
        kind: CompletionItemKind.Text,
        data: 1,
      },
      {
        label: 'JavaScript',
        kind: CompletionItemKind.Text,
        data: 2,
      },
    ]
  },
)

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
  (item: CompletionItem): CompletionItem => {
    if (item.data === 1) {
      item.detail = 'TypeScript details'
      item.documentation = 'TypeScript documentation'
    }
    else if (item.data === 2) {
      item.detail = 'JavaScript details'
      item.documentation = 'JavaScript documentation'
    }
    return item
  },
)

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection)

// Listen on the connection
connection.listen()
