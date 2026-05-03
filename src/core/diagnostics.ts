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
  return diagnostics.map(formatDiagnostic).join("\n\n");
}
