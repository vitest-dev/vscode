/* eslint-disable no-use-before-define */
/**
 * Copyright (c) 2014-present, Facebook, Inc. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type { Location } from '../../types'

/**
 * range and location here are 1-based position.
 */
export class ParsedRange {
  start: Location

  end: Location

  constructor(
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
  ) {
    this.start = { column: startCol, line: startLine }
    this.end = { column: endCol, line: endLine }
  }
}

// export type ParsedNodeType = 'expect' | 'describe' | 'it' | 'ROOT';

export const ParsedNodeTypes = {
  describe: 'describe',
  expect: 'expect',
  it: 'it',
  root: 'root',
} as const

export type ParsedNodeType = keyof typeof ParsedNodeTypes

export class ParsedNode {
  type: ParsedNodeType

  start?: Location

  end?: Location

  file: string

  children?: Array<ParsedNode>

  constructor(type: ParsedNodeType, file: string) {
    this.type = type
    this.file = file
  }

  addChild(type: ParsedNodeType): ParsedNode {
    let child: ParsedNode

    switch (type) {
      case ParsedNodeTypes.describe:
        child = new DescribeBlock(this.file)
        break
      case ParsedNodeTypes.it:
        child = new ItBlock(this.file)
        break
      case ParsedNodeTypes.expect:
        child = new Expect(this.file)
        break
      default:
        throw new TypeError(`unexpected child node type: ${type}`)
    }
    if (!this.children)
      this.children = [child]
    else
      this.children.push(child)

    return child
  }

  filter(
    f: (node: ParsedNode) => boolean,
    filterSelf = false,
  ): Array<ParsedNode> {
    const filtered: Array<ParsedNode> = []

    const _filter = (node: ParsedNode, _filterSelf: boolean) => {
      if (_filterSelf && f(node))
        filtered.push(node)

      if (node.children)
        node.children.forEach(c => _filter(c, true))
    }

    _filter(this, filterSelf)
    return filtered
  }
}

export class Expect extends ParsedNode {
  constructor(file: string) {
    super(ParsedNodeTypes.expect, file)
  }
}

export class NamedBlock extends ParsedNode {
  name?: string

  nameRange?: ParsedRange

  lastProperty?: string

  /**
   * type of the name, it's the babel Node["type"], such as "Literal", "TemplateLiteral" etc
   *
   * TODO babel parser currently returns "Literal" for the it/describe name argument, which is not part of its "type" definition, therefore declare a string type for now until it is fixed in babel.
   * */
  nameType?: string

  constructor(type: ParsedNodeType, file: string, name?: string) {
    super(type, file)
    if (name)
      this.name = name
  }
}

export class ItBlock extends NamedBlock {
  constructor(file: string, name?: string) {
    super(ParsedNodeTypes.it, file, name)
  }
}
export class DescribeBlock extends NamedBlock {
  constructor(file: string, name?: string) {
    super(ParsedNodeTypes.describe, file, name)
  }
}

// export type NodeClass = Node | Expect | ItBlock | DescribeBlock;

export class ParseResult {
  describeBlocks: Array<DescribeBlock>

  expects: Array<Expect>

  itBlocks: Array<ItBlock>

  root: ParsedNode

  file: string

  constructor(file: string) {
    this.file = file
    this.root = new ParsedNode(ParsedNodeTypes.root, file)

    this.describeBlocks = []
    this.expects = []
    this.itBlocks = []
  }

  addNode(node: ParsedNode, dedup = false) {
    if (node instanceof DescribeBlock) {
      this.describeBlocks.push(node)
    }
    else if (node instanceof ItBlock) {
      this.itBlocks.push(node)
    }
    else if (node instanceof Expect) {
      if (
        dedup
        && this.expects.some(
          e =>
            e.start?.line === node.start?.line
            && e.start?.column === node.start?.column,
        )
      ) {
        // found dup, return
        return
      }

      this.expects.push(node)
    }
    else {
      throw new TypeError(
        `unexpected node class '${typeof node}': ${JSON.stringify(node)}`,
      )
    }
  }
}
