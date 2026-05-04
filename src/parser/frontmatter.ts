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
    return readSimpleFrontmatter(source, diagnostics, file);
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
    data = parsed && typeof parsed === "object" ? normalizeFrontmatterAliases(parsed as Record<string, unknown>) : {};
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

function readSimpleFrontmatter(source: string, diagnostics: DiagnosticBag, file?: string): FrontmatterResult {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const data: Record<string, unknown> = {};
  const rawLines: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") break;
    const match = line.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ_-]*)\s*:\s*(.*?)\s*$/);
    if (!match) break;
    const canonical = frontmatterAlias(match[1]);
    if (!canonical && rawLines.length === 0) break;
    data[match[1]] = parseSimpleValue(match[2]);
    rawLines.push(line);
    index++;
  }

  if (rawLines.length === 0) return { body: source, diagnostics };
  if ((lines[index] ?? "").trim() === "") index++;

  return {
    frontmatter: {
      kind: "Frontmatter",
      raw: rawLines.join("\n"),
      data: normalizeFrontmatterAliases(data),
      position: { file, line: 1, column: 1 }
    },
    body: lines.slice(index).join("\n"),
    diagnostics
  };
}

function parseSimpleValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  try {
    return YAML.parse(trimmed);
  } catch {
    return trimmed;
  }
}

export function normalizeFrontmatterAliases(data: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...data };
  for (const [key, value] of Object.entries(data)) {
    const canonical = frontmatterAlias(key);
    if (canonical && normalized[canonical] === undefined) normalized[canonical] = value;
  }
  return normalized;
}

function frontmatterAlias(key: string): string | undefined {
  const aliases: Record<string, string> = {
    titulo: "title",
    título: "title",
    title: "title",
    subtitulo: "subtitle",
    subtítulo: "subtitle",
    subtitle: "subtitle",
    autor: "author",
    author: "author",
    fecha: "date",
    date: "date",
    idioma: "language",
    language: "language",
    plantilla: "template",
    template: "template",
    asesor: "asesor",
    orientador: "asesor",
    coasesor: "coasesor",
    "co-asesor": "coasesor",
    co_asesor: "coasesor",
    coorientador: "coasesor",
    dni: "dni",
    documento: "dni",
    orcid: "orcid",
    jurado: "jurado",
    jury: "jurado",
    institucion: "institucion",
    institución: "institucion",
    facultad: "facultad",
    escuela: "school",
    school: "school",
    grado: "academicDegree",
    titulo_profesional: "academicDegree",
    "título_profesional": "academicDegree",
    academicDegree: "academicDegree",
    fuente: "fontFamily",
    tipografia: "fontFamily",
    font: "fontFamily",
    fontFamily: "fontFamily",
    referencias: "refs",
    referencia: "refs",
    refs: "refs"
  };
  return aliases[key] ?? aliases[key.toLowerCase()];
}
