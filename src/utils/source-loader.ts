import { readFileSync } from "node:fs";
import path from "node:path";
import { DiagnosticBag } from "../core/diagnostics.js";

export interface LoadedSource {
  file: string;
  content: string;
  files: string[];
  diagnostics: DiagnosticBag;
}

export function loadSourceWithIncludes(file: string, stack: string[] = []): LoadedSource {
  const diagnostics = new DiagnosticBag();
  const absolute = path.resolve(file);
  if (stack.includes(absolute)) {
    const cycle = [...stack, absolute].map((item) => path.basename(item)).join(" -> ");
    diagnostics.error("KUI-E050", `Include cíclico detectado: ${cycle}`);
    return { file: absolute, content: "", files: [...stack, absolute], diagnostics };
  }

  let content = "";
  try {
    content = readFileSync(absolute, "utf8");
  } catch {
    diagnostics.error("KUI-E051", `No se pudo leer el archivo: ${absolute}`);
    return { file: absolute, content: "", files: [...stack, absolute], diagnostics };
  }

  const dir = path.dirname(absolute);
  const files = [absolute];
  const expanded = content.replace(/^:?(include|incluir)\s+(.+)$/gm, (_full, _directive: string, includePath: string) => {
    const resolved = path.resolve(dir, normalizeIncludePath(includePath));
    const child = loadSourceWithIncludes(resolved, [...stack, absolute]);
    diagnostics.merge(child.diagnostics);
    files.push(...child.files);
    return child.content;
  });

  return { file: absolute, content: expanded, files: [...new Set(files)], diagnostics };
}

function normalizeIncludePath(value: string): string {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^(['"])(.*)\1$/);
  return quoted ? quoted[2] : trimmed;
}
