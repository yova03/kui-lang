import YAML from "yaml";
import type { FrontmatterNode } from "../core/ast.js";
import { DiagnosticBag } from "../core/diagnostics.js";

export interface FrontmatterResult {
  frontmatter?: FrontmatterNode;
  body: string;
  diagnostics: DiagnosticBag;
}

export function readFrontmatter(source: string, file?: string): FrontmatterResult {
  const diagnostics = new DiagnosticBag();
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    return { body: source, diagnostics };
  }

  const newline = source.startsWith("---\r\n") ? "\r\n" : "\n";
  const closing = `${newline}---${newline}`;
  const closingIndex = source.indexOf(closing, 3);
  if (closingIndex === -1) {
    diagnostics.error("KUI-E010", "El frontmatter YAML empieza con --- pero no tiene cierre.", {
      file,
      line: 1,
      column: 1
    });
    return { body: source, diagnostics };
  }

  const raw = source.slice(4, closingIndex);
  let data: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(raw);
    data = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch (error) {
    diagnostics.error("KUI-E011", "El frontmatter YAML no se pudo leer.", {
      file,
      line: 1,
      column: 1
    }, error instanceof Error ? error.message : undefined);
  }

  const body = source.slice(closingIndex + closing.length);
  return {
    frontmatter: {
      kind: "Frontmatter",
      raw,
      data,
      position: { file, line: 1, column: 1 }
    },
    body,
    diagnostics
  };
}
