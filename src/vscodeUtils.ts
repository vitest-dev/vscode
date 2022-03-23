import { Uri, workspace } from "vscode";
import { TextDecoder } from "util";
import { getConfig } from "./config";
import minimatch = require("minimatch");

const textDecoder = new TextDecoder("utf-8");

export const getContentFromFilesystem = async (uri: Uri) => {
  try {
    const rawContent = await workspace.fs.readFile(uri);
    return textDecoder.decode(rawContent);
  } catch (e) {
    console.warn(`Error providing tests for ${uri.fsPath}`, e);
    return "";
  }
};

export function shouldIncludeFile(path: string) {
  const { include, exclude } = getConfig();
  return (
    include.some((x) => minimatch(path, x)) &&
    exclude.every((x) => !minimatch(path, x))
  );
}
