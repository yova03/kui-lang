export type Severity = "error" | "warning" | "info";

export interface SourcePosition {
  file?: string;
  line: number;
  column: number;
  offset?: number;
}

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  hint?: string;
  position?: SourcePosition;
}

export class DiagnosticBag {
  readonly diagnostics: Diagnostic[] = [];

  add(diagnostic: Diagnostic): void {
    this.diagnostics.push(diagnostic);
  }

  error(code: string, message: string, position?: SourcePosition, hint?: string): void {
    this.add({ code, severity: "error", message, position, hint });
  }

  warning(code: string, message: string, position?: SourcePosition, hint?: string): void {
    this.add({ code, severity: "warning", message, position, hint });
  }

  info(code: string, message: string, position?: SourcePosition, hint?: string): void {
    this.add({ code, severity: "info", message, position, hint });
  }

  hasErrors(): boolean {
    return this.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  }

  merge(other: DiagnosticBag | Diagnostic[]): void {
    const diagnostics = Array.isArray(other) ? other : other.diagnostics;
    this.diagnostics.push(...diagnostics);
  }
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const where = diagnostic.position
    ? `${diagnostic.position.file ?? "<input>"}:${diagnostic.position.line}:${diagnostic.position.column}`
    : "<project>";
  const hint = diagnostic.hint ? `\n  ayuda: ${diagnostic.hint}` : "";
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${where}\n  ${diagnostic.message}${hint}`;
}

export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) return "Sin diagnósticos.";
  const sorted = [...diagnostics].sort((a, b) => {
    const fileCompare = diagnosticFile(a).localeCompare(diagnosticFile(b));
    if (fileCompare !== 0) return fileCompare;
    const severityCompare = severityRank(a.severity) - severityRank(b.severity);
    if (severityCompare !== 0) return severityCompare;
    return (a.position?.line ?? 0) - (b.position?.line ?? 0);
  });

  const groups = new Map<string, Diagnostic[]>();
  for (const diagnostic of sorted) {
    const file = diagnosticFile(diagnostic);
    groups.set(file, [...(groups.get(file) ?? []), diagnostic]);
  }

  return [...groups.entries()]
    .map(([file, items]) => `${file}\n${items.map(formatGroupedDiagnostic).join("\n\n")}`)
    .join("\n\n");
}

function formatGroupedDiagnostic(diagnostic: Diagnostic): string {
  const where = diagnostic.position ? `${diagnostic.position.line}:${diagnostic.position.column}` : "";
  const hint = diagnostic.hint ? `\n  ayuda: ${diagnostic.hint}` : "";
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.code}${where ? ` ${where}` : ""}\n  ${diagnostic.message}${hint}`;
}

function diagnosticFile(diagnostic: Diagnostic): string {
  return diagnostic.position?.file ?? "<project>";
}

function severityRank(severity: Severity): number {
  if (severity === "error") return 0;
  if (severity === "warning") return 1;
  return 2;
}
