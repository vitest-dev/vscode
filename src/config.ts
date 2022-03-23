import { workspace } from "vscode";
export const extensionId = "zxch3n.vitest-explorer";

export function getConfig() {
  const config = workspace.getConfiguration("vitest");
  return {
    env: config.get("nodeEnv") as null | Record<string, string>,
    commandLine: config.get("commandLine") as string,
    include: config.get("include") as string[],
    exclude: config.get("exclude") as string[],
  };
}
