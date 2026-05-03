import { readFileSync } from "node:fs";

export function readBibKeys(path: string): Set<string> {
  const keys = new Set<string>();
  let content = "";
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return keys;
  }
  const entryPattern = /@\w+\s*\{\s*([^,\s]+)\s*,/g;
  for (const match of content.matchAll(entryPattern)) {
    keys.add(match[1]);
  }
  return keys;
}
