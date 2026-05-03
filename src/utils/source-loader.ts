import { readFileSync } from "node:fs";
import path from "node:path";
import { DiagnosticBag } from "../core/diagnostics.js";

export interface LoadedSource {
  file: string;
  content: string;
  files: string[];
  diagnostics: DiagnosticBag;
}

export function loadSourceWithIncludes(file: string, seen = new Set<string>()): LoadedSource {
  const diagnostics = new DiagnosticBag();
  const absolute = path.resolve(file);
  if (seen.has(absolute)) {
    diagnostics.error("KUI-E050", `Include cíclico detectado: ${absolute}`);
    return { file: absolute, content: "", files: [...seen], diagnostics };
  }
  seen.add(absolute);

  let content = "";
  try {
    content = readFileSync(absolute, "utf8");
  } catch {
    diagnostics.error("KUI-E051", `No se pudo leer el archivo: ${absolute}`);
    return { file: absolute, content: "", files: [...seen], diagnostics };
  }

  const dir = path.dirname(absolute);
  const files = [absolute];
  const expanded = content.replace(/^:include\s+(.+)$/gm, (_full, includePath: string) => {
    const resolved = path.resolve(dir, includePath.trim());
    const child = loadSourceWithIncludes(resolved, seen);
    diagnostics.merge(child.diagnostics);
    files.push(...child.files);
    return child.content;
  });

  return { file: absolute, content: expanded, files: [...new Set(files)], diagnostics };
}
