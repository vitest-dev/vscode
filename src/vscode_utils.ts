import { Uri, workspace } from "vscode";
import { TextDecoder } from "util";

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
