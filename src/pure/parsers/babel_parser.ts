//@ts-nocheck
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-param-reassign */
/**
 * Copyright (c) 2014-present, Facebook, Inc. All rights reserved.
 *
 * This source code is licensed under the MIT license
 *
 * @flow
 */

import { readFileSync } from "fs";
import { File as BabelFile, Node as BabelNode, Statement } from "@babel/types";
import * as parser from "@babel/parser";
import type { ParsedNodeType } from "./parser_nodes";
import {
  NamedBlock,
  ParsedNode,
  ParsedRange,
  ParseResult,
} from "./parser_nodes";
import { parseOptions } from "./helper";

const _getASTfor = (
  file: string,
  data?: string,
  options?: parser.ParserOptions,
): [BabelFile, string] => {
  const _data = data || readFileSync(file).toString();
  const config = { ...options, sourceType: "module" as const };
  return [parser.parse(_data, config), _data];
};

export const getASTfor = (file: string, data?: string): BabelFile => {
  const [bFile] = _getASTfor(file, data, parseOptions(file));
  return bFile;
};

export function doesImportVitest(ast: BabelFile): boolean {
  return ast.program.body.some((x) => {
    return x.type === "ImportDeclaration" && x.source.value === "vitest";
  });
}

export const parse = (
  file: string,
  data?: string,
  options?: parser.ParserOptions,
): ParseResult => {
  const parseResult = new ParseResult(file);
  const [ast, _data] = _getASTfor(file, data, options);

  const deepGet = (node: BabelNode, ...types: string[]) =>
    types.reduce<BabelNode>((rootForType, type) => {
      //@ts-ignore
      while (rootForType[type]) {
        //@ts-ignore
        rootForType = rootForType[type];
      }
      return rootForType;
    }, node);

  const updateNameInfo = (
    nBlock: NamedBlock,
    bNode: BabelNode,
    lastProperty?: string,
  ) => {
    //@ts-ignore
    const arg = bNode.expression.arguments[0];
    let name = arg.value;

    if (!name) {
      switch (arg.type) {
        case "TemplateLiteral":
          name = _data.substring(arg.start + 1, arg.end - 1);
          break;
        default:
          name = _data.substring(arg.start, arg.end);
          break;
      }
    }

    nBlock.name = name;
    nBlock.nameType = arg.type;
    nBlock.lastProperty = lastProperty;
    nBlock.nameRange = new ParsedRange(
      arg.loc.start.line,
      arg.loc.start.column + 2,
      arg.loc.end.line,
      arg.loc.end.column - 1,
    );
  };

  const updateNode = (
    node: ParsedNode,
    babylonNode: BabelNode,
    lastProperty?: string,
  ) => {
    //@ts-ignore
    node.start = babylonNode.loc.start;
    //@ts-ignore
    node.end = babylonNode.loc.end;
    node.start.column += 1;

    parseResult.addNode(node);
    if (node instanceof NamedBlock) {
      updateNameInfo(node, babylonNode, lastProperty);
    }
  };

  const isFunctionCall = (node: BabelNode) =>
    node && node.type === "ExpressionStatement" && node.expression &&
    node.expression.type === "CallExpression";

  const isFunctionDeclaration = (nodeType: string) =>
    nodeType === "ArrowFunctionExpression" || nodeType === "FunctionExpression";

  // Pull out the name of a CallExpression (describe/it) and the last property (each, skip etc)
  const getNameForNode = (node: any) => {
    if (isFunctionCall(node) && node.expression.callee) {
      // Get root callee in case it's a chain of higher-order functions (e.g. .each(table)(name, fn))
      const rootCallee = deepGet(node.expression, "callee");
      const property = rootCallee.property?.name ||
        deepGet(rootCallee, "tag").property?.name;
      const name = rootCallee.name ||
        // handle cases where it's a member expression (e.g .only or .concurrent.only)
        deepGet(rootCallee, "object").name ||
        // handle cases where it's part of a tag (e.g. .each`table`)
        deepGet(rootCallee, "tag", "object").name;

      return [name, property];
    }
    return [];
  };

  // When given a node in the AST, does this represent
  // the start of an it/test block?
  const isAnIt = (name?: string) => {
    return name === "it" || name === "fit" || name === "test";
  };

  const isAnDescribe = (name?: string) => {
    return name === "describe";
  };

  // When given a node in the AST, does this represent
  // the start of an expect expression?
  const isAnExpect = (node: any) => {
    if (!isFunctionCall(node)) {
      return false;
    }
    let name = "";
    let element = node && node.expression ? node.expression.callee : undefined;
    while (!name && element) {
      // eslint-disable-next-line prefer-destructuring
      name = element.name;
      // Because expect may have accessors tacked on (.to.be) or nothing
      // (expect()) we have to check multiple levels for the name
      element = element.object || element.callee;
    }
    return name === "expect";
  };

  const addNode = (
    type: ParsedNodeType,
    parent: ParsedNode,
    babylonNode: BabelNode,
    lastProperty?: string,
  ): ParsedNode => {
    const child = parent.addChild(type);
    updateNode(child, babylonNode, lastProperty);

    if (child instanceof NamedBlock && child.name == null) {
      // eslint-disable-next-line no-console
      console.warn(`block is missing name: ${JSON.stringify(babylonNode)}`);
    }
    return child;
  };

  // A recursive AST parser
  const searchNodes = (babylonParent: any, parent: ParsedNode) => {
    // Look through the node's children
    let child: ParsedNode | undefined;

    if (!babylonParent.body || !Array.isArray(babylonParent.body)) {
      return;
    }

    babylonParent.body.forEach((element: Statement) => {
      child = undefined;
      // Pull out the node
      // const element = babylonParent.body[node];

      const [name, lastProperty] = getNameForNode(element);
      if (isAnDescribe(name)) {
        child = addNode("describe", parent, element, lastProperty);
      } else if (isAnIt(name)) {
        child = addNode("it", parent, element, lastProperty);
      } else if (isAnExpect(element)) {
        child = addNode("expect", parent, element);
      } else if (element && element.type === "VariableDeclaration") {
        element.declarations
          .filter((declaration) =>
            declaration.init && isFunctionDeclaration(declaration.init.type)
          )
          .forEach((declaration) => searchNodes(declaration.init.body, parent));
      } else if (
        element &&
        element.type === "ExpressionStatement" &&
        element.expression &&
        element.expression.type === "AssignmentExpression" &&
        element.expression.right &&
        isFunctionDeclaration(element.expression.right.type)
      ) {
        searchNodes(element.expression.right.body, parent);
      } else if (
        element.type === "ReturnStatement" && element.argument?.arguments
      ) {
        element.argument.arguments
          .filter((argument) => isFunctionDeclaration(argument.type))
          .forEach((argument) => searchNodes(argument.body, parent));
      }

      if (isFunctionCall(element)) {
        element.expression.arguments
          .filter((argument) => isFunctionDeclaration(argument.type))
          .forEach((argument) => searchNodes(argument.body, child || parent));
      }
    });
  };

  const { program } = ast;
  searchNodes(program, parseResult.root);

  return parseResult;
};
