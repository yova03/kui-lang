import { existsSync } from "node:fs";
import path from "node:path";
import type {
  BlockNode,
  CitationNode,
  CrossRefNode,
  DocumentNode,
  FigureNode,
  InlineNode,
  TableNode
} from "../core/ast.js";
import { DiagnosticBag } from "../core/diagnostics.js";
import { normalizeReferenceSources, readReferenceKeys } from "./bibliography.js";
import { findTemplate, listTemplates } from "../templates/registry.js";
import { auditDocumentAssets } from "./assets.js";
import { closestMatch } from "../utils/suggestions.js";

export interface ValidationOptions {
  cwd: string;
  strict?: boolean;
  checks?: ValidationCheck[];
}

export type ValidationCheck = "frontmatter" | "refs" | "bib" | "assets" | "tables" | "accessibility";

const allValidationChecks: ValidationCheck[] = ["frontmatter", "refs", "bib", "assets", "tables", "accessibility"];

export function validateDocument(document: DocumentNode, options: ValidationOptions): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  diagnostics.merge(document.diagnostics);
  const checks = new Set(options.checks && options.checks.length > 0 ? options.checks : allValidationChecks);

  if (checks.has("frontmatter")) validateFrontmatter(document, diagnostics);
  if (checks.has("refs")) validateLabels(document, diagnostics);
  if (checks.has("bib")) validateBibliography(document, diagnostics, options.cwd);
  if (checks.has("assets")) validateAssets(document, diagnostics, options.cwd);
  if (checks.has("tables")) validateTables(document, diagnostics);
  if (checks.has("accessibility")) validateAccessibility(document, diagnostics);

  if (options.strict) {
    for (const diagnostic of diagnostics.diagnostics) {
      if (diagnostic.severity === "warning") diagnostic.severity = "error";
    }
  }

  return diagnostics;
}

function validateFrontmatter(document: DocumentNode, diagnostics: DiagnosticBag): void {
  const data = document.frontmatter?.data ?? {};
  if (!document.frontmatter) {
    diagnostics.warning(
      "KUI-W010",
      "El documento no tiene frontmatter. Se usará la plantilla default paper-APA.",
      document.position,
      "Agrega ---\\ntemplate: paper-APA\\n--- para hacerlo explícito."
    );
    return;
  }
  if (!data.template) {
    diagnostics.warning(
      "KUI-W011",
      "El frontmatter no declara template.",
      document.frontmatter.position,
      "Usa template: paper-IEEE, paper-APA o tesis-unsaac."
    );
    return;
  }

  const template = findTemplate(data.template);
  if (!template) {
    const templateId = String(data.template);
    const suggestion = closestMatch(
      templateId,
      listTemplates().map((candidate) => candidate.id)
    );
    const hint = suggestion
      ? `Quizas quisiste decir "${suggestion}". Ejecuta kui templates para ver las plantillas disponibles.`
      : "Ejecuta kui templates para ver las plantillas disponibles.";
    diagnostics.error(
      "KUI-E060",
      `La plantilla "${String(data.template)}" no está instalada.`,
      document.frontmatter.position,
      hint
    );
    return;
  }

  for (const field of template.requiredFields) {
    if (!hasFrontmatterValue(data[field])) {
      diagnostics.error(
        "KUI-E061",
        `La plantilla "${template.id}" requiere el campo "${field}" en frontmatter.`,
        document.frontmatter.position
      );
    }
  }
}

function validateLabels(document: DocumentNode, diagnostics: DiagnosticBag): void {
  const labels = new Map<string, number>();
  const labelTypes = new Map<string, string>();
  const refs: CrossRefNode[] = [];

  visitBlocks(document.children, {
    block(node) {
      if (node.attrs?.id) {
        labels.set(node.attrs.id, (labels.get(node.attrs.id) ?? 0) + 1);
        labelTypes.set(node.attrs.id, labelTypeForBlock(node));
      }
    },
    inline(node) {
      if (node.kind === "CrossRef") refs.push(node);
    }
  });

  for (const [label, count] of labels) {
    if (count > 1) {
      diagnostics.error("KUI-E020", `El label "${label}" está duplicado.`, document.symbols.labels[label]);
    }
  }

  for (const ref of refs) {
    if (!labels.has(ref.id)) {
      const suggestion = closestMatch(ref.id, [...labels.keys()]);
      diagnostics.warning(
        "KUI-W002",
        `La referencia @${ref.id} no apunta a ningún label del documento.`,
        ref.position,
        suggestion
          ? `Quizas quisiste decir @${suggestion}. Revisa que el tipo (${ref.refType}) coincida.`
          : "Revisa que exista un atributo {#...} con el mismo id."
      );
      continue;
    }
    const actualType = labelTypes.get(ref.id);
    if (actualType && actualType !== ref.refType) {
      diagnostics.warning(
        "KUI-W003",
        `La referencia @${ref.id} espera "${ref.refType}", pero el label pertenece a "${actualType}".`,
        ref.position
      );
    }
  }
}

function validateBibliography(document: DocumentNode, diagnostics: DiagnosticBag, cwd: string): void {
  const data = document.frontmatter?.data ?? {};
  const bibliographySources = normalizeReferenceSources(data);
  const keys = new Set<string>();
  for (const source of bibliographySources) {
    const sourcePath = path.resolve(cwd, source.path);
    if (!existsSync(sourcePath)) {
      diagnostics.warning("KUI-W020", `El archivo bibliográfico no existe: ${source.path}`, document.frontmatter?.position);
      continue;
    }
    for (const key of readReferenceKeys(sourcePath)) keys.add(key);
  }
  document.symbols.bibliographyKeys = keys;

  const citations: CitationNode[] = [];
  visitBlocks(document.children, {
    inline(node) {
      if (node.kind === "Citation") citations.push(node);
    }
  });

  if (citations.length > 0 && bibliographySources.length === 0) {
    diagnostics.warning(
      "KUI-W021",
      "El documento tiene citas pero no declara bib: o refs: en frontmatter.",
      citations[0].position
    );
    return;
  }

  for (const citation of citations) {
    for (const item of citation.items) {
      if (keys.size > 0 && !keys.has(item.key)) {
        const suggestion = closestMatch(item.key, [...keys]);
        diagnostics.warning(
          "KUI-W001",
          `La cita "${item.key}" no existe en los archivos bibliográficos declarados.`,
          citation.position,
          suggestion ? `Quizas quisiste citar @${suggestion}.` : undefined
        );
      }
    }
  }
}

function validateAssets(document: DocumentNode, diagnostics: DiagnosticBag, cwd: string): void {
  const audit = auditDocumentAssets(document, { cwd, includeCaptionDiagnostics: false });
  diagnostics.merge(audit.diagnostics);
}

function validateAccessibility(document: DocumentNode, diagnostics: DiagnosticBag): void {
  const figures: FigureNode[] = [];
  visitBlocks(document.children, {
    block(node) {
      if (node.kind === "Figure") figures.push(node);
    }
  });

  for (const figure of figures) {
    if (!figure.alt.trim()) {
      diagnostics.warning(
        "KUI-W030",
        `La figura "${figure.path}" no tiene texto alternativo/caption.`,
        figure.position
      );
    }
  }

  validateHeadings(document, diagnostics);
}

function validateTables(document: DocumentNode, diagnostics: DiagnosticBag): void {
  const tables: TableNode[] = [];
  visitBlocks(document.children, {
    block(node) {
      if (node.kind === "Table") tables.push(node);
    }
  });

  for (const table of tables) {
    const expected = table.headers.length;
    table.rows.forEach((row, index) => {
      if (row.length !== expected) {
        diagnostics.warning(
          "KUI-W032",
          `La fila ${index + 1} de la tabla tiene ${row.length} columnas, pero el encabezado tiene ${expected}.`,
          table.position,
          "El PDF normalizará la fila, pero conviene corregir la tabla fuente."
        );
      }
    });
  }
}

function validateHeadings(document: DocumentNode, diagnostics: DiagnosticBag): void {
  let previousLevel = 0;
  visitBlocks(document.children, {
    block(node) {
      if (node.kind !== "Heading") return;
      if (previousLevel > 0 && node.level > previousLevel + 1) {
        diagnostics.warning(
          "KUI-W040",
          `El heading salta de nivel ${previousLevel} a ${node.level}.`,
          node.position,
          "Para accesibilidad, evita saltar niveles."
        );
      }
      previousLevel = node.level;
    }
  });
}

interface Visitors {
  block?: (node: BlockNode) => void;
  inline?: (node: InlineNode) => void;
}

function visitBlocks(blocks: BlockNode[], visitors: Visitors): void {
  for (const block of blocks) {
    visitors.block?.(block);
    if (block.kind === "Heading") block.title.forEach((inline) => visitInline(inline, visitors));
    if (block.kind === "Paragraph" || block.kind === "FootnoteDef") {
      block.children.forEach((inline) => visitInline(inline, visitors));
    }
    if (block.kind === "Figure") block.caption.forEach((inline) => visitInline(inline, visitors));
    if (block.kind === "Table") {
      block.headers.flat().forEach((inline) => visitInline(inline, visitors));
      block.rows.flat(2).forEach((inline) => visitInline(inline, visitors));
      block.caption?.forEach((inline) => visitInline(inline, visitors));
    }
    if (block.kind === "List") {
      for (const item of block.items) item.children.forEach((inline) => visitInline(inline, visitors));
    }
    if (block.kind === "FencedDiv" || block.kind === "Blockquote" || block.kind === "Callout") {
      visitBlocks(block.children, visitors);
    }
  }
}

function visitInline(inline: InlineNode, visitors: Visitors): void {
  visitors.inline?.(inline);
  if ("children" in inline && Array.isArray(inline.children)) {
    inline.children.forEach((child) => visitInline(child, visitors));
  }
}

function hasFrontmatterValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== undefined && value !== null;
}

function labelTypeForBlock(node: BlockNode): string {
  if (node.kind === "Figure") return "fig";
  if (node.kind === "Table") return "tbl";
  if (node.kind === "MathBlock") return "eq";
  if (node.kind === "Heading") return "sec";
  if (node.kind === "FencedDiv") {
    const name = node.canonicalName ?? node.name;
    if (name === "definition") return "def";
    if (name === "theorem") return "thm";
    if (name === "lemma") return "lem";
    if (name === "corollary") return "cor";
  }
  return "sec";
}
