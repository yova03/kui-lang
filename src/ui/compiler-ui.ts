import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import fg from "fast-glob";
import type { BlockNode, DocumentNode, FencedDivNode, InlineNode } from "../core/ast.js";
import { compileToNativePdf, CompileAbortedError } from "../core/compiler.js";
import { parseKui } from "../parser/kui-parser.js";
import { validateDocument } from "../semantic/validator.js";
import { findTemplate, type TemplateManifest } from "../templates/registry.js";
import { loadSourceWithIncludes } from "../utils/source-loader.js";

const root = process.cwd();
const port = Number(readArg("--port") ?? process.env.KUI_UI_PORT ?? 4321);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "GET" && url.pathname === "/") return sendHtml(response, pageHtml());
    if (request.method === "GET" && url.pathname === "/api/examples") return sendJson(response, examplesPayload());
    if (request.method === "GET" && url.pathname === "/api/inspect") return sendJson(response, inspectPayload(url.searchParams.get("file")));
    if (request.method === "POST" && url.pathname === "/api/compile") return sendJson(response, await compilePayload(request));
    if (request.method === "GET" && url.pathname === "/artifact") return sendArtifact(response, url.searchParams.get("file"));
    sendJson(response, { error: "Ruta no encontrada." }, 404);
  } catch (error) {
    sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

server.listen(port, () => {
  console.log(`KUI Compiler UI: http://localhost:${port}`);
});

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function examplesPayload(): { examples: string[] } {
  const examples = fg.sync("examples/**/*.kui", { cwd: root, onlyFiles: true }).sort();
  return { examples };
}

function inspectPayload(file: string | null): unknown {
  const relative = file ?? "examples/academico-completo.kui";
  const absolute = safeResolve(relative);
  const source = loadSourceWithIncludes(absolute);
  const document = parseKui(source.content, { file: source.file });
  document.sourceFiles = source.files;
  document.diagnostics.push(...source.diagnostics.diagnostics);
  const validation = validateDocument(document, { cwd: path.dirname(source.file) });
  document.diagnostics = validation.diagnostics;

  return {
    file: path.relative(root, source.file),
    source: source.content,
    includedFiles: source.files.map((item) => path.relative(root, item)),
    frontmatter: document.frontmatter?.data ?? {},
    diagnostics: document.diagnostics,
    template: templatePayload(document),
    stats: documentStats(document),
    ast: summarizeDocument(document),
    symbols: {
      labels: Object.keys(document.symbols.labels).sort(),
      citations: Object.keys(document.symbols.citations).sort(),
      bibliographyKeys: [...document.symbols.bibliographyKeys].sort()
    },
    pipeline: pipelineFor(relative),
    commands: {
      check: `npm run dev -- check ${relative}`,
      pdf: `npm run dev -- pdf ${relative}`,
      buildDist: "npm run build",
      pdfFromDist: `node dist/src/cli/index.js pdf ${relative}`
    },
    guide: compilerGuide()
  };
}

async function compilePayload(request: http.IncomingMessage): Promise<unknown> {
  const body = await readBody(request);
  const payload = JSON.parse(body || "{}") as { file?: string };
  const relative = payload.file ?? "examples/academico-completo.kui";
  const absolute = safeResolve(relative);
  const input = path.relative(root, absolute);
  try {
    const result = await compileToNativePdf(input, { cwd: root, outputDir: "build" });
    const bytes = readFileSync(result.output.pdfPath);
    return {
      ok: true,
      diagnostics: result.output.diagnostics,
      pdfPath: path.relative(root, result.output.pdfPath),
      pdfUrl: `/artifact?file=${encodeURIComponent(path.relative(root, result.output.pdfPath))}`,
      byteLength: result.output.pdfBytes.byteLength,
      pageCount: countPdfPages(bytes)
    };
  } catch (error) {
    if (error instanceof CompileAbortedError) return { ok: false, diagnostics: error.diagnostics };
    throw error;
  }
}

function sendArtifact(response: http.ServerResponse, file: string | null): void {
  if (!file) return sendJson(response, { error: "Falta file." }, 400);
  const absolute = safeResolve(file);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return sendJson(response, { error: "No existe el artefacto." }, 404);
  if (path.extname(absolute).toLowerCase() !== ".pdf") return sendJson(response, { error: "Solo se sirven PDFs." }, 400);
  response.writeHead(200, { "Content-Type": "application/pdf" });
  createReadStream(absolute).pipe(response);
}

function safeResolve(relativeOrAbsolute: string): string {
  const absolute = path.resolve(root, relativeOrAbsolute);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error("Ruta fuera del proyecto.");
  }
  return absolute;
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > 1_000_000) request.destroy(new Error("Request demasiado grande."));
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function documentStats(document: DocumentNode): Record<string, number> {
  const counts: Record<string, number> = {};
  const visit = (block: BlockNode): void => {
    counts[block.kind] = (counts[block.kind] ?? 0) + 1;
    if (block.kind === "FencedDiv" || block.kind === "Blockquote" || block.kind === "Callout") block.children.forEach(visit);
  };
  document.children.forEach(visit);
  return counts;
}

function summarizeDocument(document: DocumentNode): unknown[] {
  return document.children.map((block) => summarizeBlock(block));
}

function summarizeBlock(block: BlockNode): unknown {
  if (block.kind === "Heading") return { kind: block.kind, level: block.level, title: inlineText(block.title), id: block.attrs?.id };
  if (block.kind === "Paragraph") return { kind: block.kind, preview: inlineText(block.children).slice(0, 140) };
  if (block.kind === "List") return { kind: block.kind, ordered: block.ordered, items: block.items.map((item) => inlineText(item.children).slice(0, 90)) };
  if (block.kind === "Table") return {
    kind: block.kind,
    columns: block.headers.length,
    rows: block.rows.length,
    caption: block.caption ? inlineText(block.caption) : undefined,
    id: block.attrs?.id
  };
  if (block.kind === "FencedDiv") return {
    kind: block.kind,
    name: block.name,
    canonicalName: block.canonicalName,
    title: semanticBlockTitle(block),
    children: block.children.map((child) => summarizeBlock(child))
  };
  if (block.kind === "Directive") return { kind: block.kind, name: block.name, args: block.args };
  if (block.kind === "MathBlock") return { kind: block.kind, preview: block.content.slice(0, 120), id: block.attrs?.id };
  if (block.kind === "Figure") return { kind: block.kind, path: block.path, caption: inlineText(block.caption), id: block.attrs?.id };
  if (block.kind === "CodeBlock") return { kind: block.kind, language: block.language, lines: block.content.split("\n").length };
  if (block.kind === "Blockquote" || block.kind === "Callout") return { kind: block.kind, children: block.children.map((child) => summarizeBlock(child)) };
  return { kind: block.kind };
}

function inlineText(nodes: InlineNode[]): string {
  return nodes.map((node) => {
    if (node.kind === "Text" || node.kind === "InlineCode") return "value" in node ? node.value : "";
    if (node.kind === "Bold" || node.kind === "Italic" || node.kind === "Link" || node.kind === "Span") return inlineText(node.children);
    if (node.kind === "MathInline") return `$${node.content}$`;
    if (node.kind === "Citation") return `@${node.items.map((item) => item.key).join(";")}`;
    if (node.kind === "CrossRef") return `@${node.id}`;
    if (node.kind === "FootnoteRef") return `[^${node.id}]`;
    if (node.kind === "ImageInline") return node.alt;
    return "";
  }).join("");
}

function semanticBlockTitle(block: FencedDivNode): string | undefined {
  return block.attrs?.normalized.title ?? block.attrs?.kv.title;
}

function pipelineFor(file: string): Array<{ step: string; module: string; note: string }> {
  return [
    { step: "1. Cargar fuente", module: "loadSourceWithIncludes", note: `Lee ${file} y expande :incluir/:include.` },
    { step: "2. Parsear", module: "parseKui", note: "Convierte frontmatter, bloques, tablas, referencias y directivas en AST." },
    { step: "3. Validar", module: "validateDocument", note: "Revisa plantilla, metadatos, citas, labels y errores fatales." },
    { step: "4. Resolver plantilla", module: "resolveTemplate", note: "Aplica margenes, colores, engine y reglas del documento." },
    { step: "5. Render PDF", module: "emitNativePdf", note: "Usa PDFKit, fuentes registradas, tablas con ancho util, encabezados, pies y bloques semanticos." },
    { step: "6. Escribir artefacto", module: "compileToNativePdf", note: "Guarda build/*.pdf y devuelve bytes + diagnosticos." }
  ];
}

function templatePayload(document: DocumentNode): unknown {
  const template = findTemplate(document.frontmatter?.data.template);
  const fontFamily = document.frontmatter?.data.fontFamily ?? document.frontmatter?.data.font_family ?? "Arial Narrow";
  if (!template) return { id: "unknown", name: "No instalada", fontFamily };
  return {
    id: template.id,
    name: template.name,
    pdfEngine: template.pdfEngine,
    requiredFields: template.requiredFields,
    supports: template.supports,
    margins: marginPayload(template),
    fontFamily
  };
}

function marginPayload(template: TemplateManifest): unknown {
  const { top, right, bottom, left } = template.defaultStyle.margins;
  return {
    top,
    right,
    bottom,
    left,
    usableWidth: 595.28 - left - right,
    usableHeight: 841.89 - top - bottom,
    note: "A4 en puntos PDF. Las tablas se calculan dentro del ancho util para evitar desbordes."
  };
}

function compilerGuide(): unknown {
  return {
    overview: [
      {
        title: "KUI como entrada",
        body: "Un archivo .kui mezcla frontmatter YAML, Markdown academico, tablas, referencias y bloques semanticos."
      },
      {
        title: "AST como contrato",
        body: "El parser no dibuja nada: primero produce un DocumentNode con bloques, inline nodes, simbolos y diagnosticos."
      },
      {
        title: "PDF nativo",
        body: "La salida PDF se compone con PDFKit. No pasa por LaTeX: margenes, tablas, fuentes y paginas se calculan en TypeScript."
      },
      {
        title: "Margenes primero",
        body: "La plantilla define el rectangulo util. El renderer usa ese espacio para tablas, pies, encabezados y saltos de pagina."
      }
    ],
    modules: [
      {
        name: "CLI",
        file: "src/cli/index.ts",
        does: "Expone comandos como check, pdf, batch-pdf y clean. Traduce flags del usuario a opciones del compilador.",
        output: "Llama a compileToNativePdf o validateDocument."
      },
      {
        name: "Source loader",
        file: "src/utils/source-loader.ts",
        does: "Lee el archivo principal y expande directivas :incluir/:include manteniendo la lista de archivos fuente.",
        output: "LoadedSource con content, file, files y diagnosticos de lectura."
      },
      {
        name: "Parser KUI",
        file: "src/parser/kui-parser.ts",
        does: "Reconoce frontmatter, headings, parrafos, listas, tablas, formulas, figuras, notas, referencias y fenced divs.",
        output: "DocumentNode con children y SymbolTable inicial."
      },
      {
        name: "AST",
        file: "src/core/ast.ts",
        does: "Define el modelo interno: BlockNode, InlineNode, atributos, labels, citas y assets.",
        output: "Contrato estable entre parser, validador y renderer."
      },
      {
        name: "Validador semantico",
        file: "src/semantic/validator.ts",
        does: "Valida plantillas, campos requeridos, labels duplicados, referencias cruzadas, bibliografia, assets y estructura de tablas.",
        output: "DiagnosticBag con warnings o errores fatales."
      },
      {
        name: "Plantillas",
        file: "src/templates/registry.ts",
        does: "Resuelve estilos de documento: campos obligatorios, soporte de indices, colores, fuente base y margenes.",
        output: "TemplateManifest usado por el PDF nativo."
      },
      {
        name: "Renderer PDF nativo",
        file: "src/pdf/native-pdf.ts",
        does: "Registra fuentes, calcula paginas, dibuja titulos, parrafos, tablas, formulas, notas, referencias y bloques semanticos.",
        output: "NativePdfOutput con pdfPath, pdfBytes y diagnosticos."
      },
      {
        name: "Orquestador",
        file: "src/core/compiler.ts",
        does: "Une todo el flujo: cargar, parsear, validar, abortar si hay errores, renderizar y devolver el artefacto.",
        output: "build/*.pdf listo para abrir."
      }
    ],
    syntax: [
      {
        token: "--- frontmatter ---",
        purpose: "Metadatos de documento: template, title, author, fontFamily, bib, period y campos requeridos por plantilla.",
        example: "template: informe-operativo\\nfontFamily: Arial Narrow"
      },
      {
        token: "# / ## / ###",
        purpose: "Titulos jerarquicos. Alimentan el AST, el indice y los contadores de secciones.",
        example: "## Hallazgos operativos {#sec:hallazgos}"
      },
      {
        token: "| tablas |",
        purpose: "Tablas Markdown con caption opcional. El renderer calcula columnas, wrapping, zebra y saltos de pagina segun margenes.",
        example: "| Indicador | Valor | Estado |"
      },
      {
        token: ":::bloque",
        purpose: "Bloques semanticos como resumen-operativo, kpi-grid, matriz-riesgo, semaforo, cronograma y firma.",
        example: ":::kpi-grid {title=\"Indicadores\"}"
      },
      {
        token: ":directiva",
        purpose: "Directivas de estructura: indice, tablas, figuras, bibliografia, nueva pagina e inclusiones.",
        example: ":indice"
      },
      {
        token: "@tbl:id / @fig:id / @eq:id",
        purpose: "Referencias cruzadas. El validador revisa que el label exista y que el tipo coincida.",
        example: "Ver @tbl:costos para el detalle."
      },
      {
        token: "[^nota]",
        purpose: "Notas al pie. El parser crea referencias inline y definiciones; el renderer las numera al final de pagina/seccion.",
        example: "Texto con nota[^1].\\n\\n[^1]: Detalle metodologico."
      }
    ],
    dataModel: [
      {
        name: "DocumentNode",
        fields: "frontmatter, children, diagnostics, symbols, sourceFiles",
        why: "Es el documento completo despues de parsear."
      },
      {
        name: "BlockNode",
        fields: "Heading, Paragraph, Table, Figure, MathBlock, FencedDiv, Directive, FootnoteDef",
        why: "Representa piezas verticales que el renderer coloca en pagina."
      },
      {
        name: "InlineNode",
        fields: "Text, Bold, Italic, Link, MathInline, Citation, CrossRef, FootnoteRef",
        why: "Representa contenido dentro de parrafos, celdas y captions."
      },
      {
        name: "SymbolTable",
        fields: "labels, citations, bibliographyKeys, assets",
        why: "Permite validar referencias antes de generar el PDF."
      },
      {
        name: "NativePdfContext",
        fields: "doc, template, fonts, labels, counters, footnotes, diagnostics",
        why: "Estado vivo usado mientras PDFKit dibuja cada pagina."
      }
    ],
    outputs: [
      {
        name: "Diagnosticos",
        body: "Warnings y errores con codigo KUI. Si hay errores, compileToNativePdf aborta antes de renderizar."
      },
      {
        name: "PDF bytes",
        body: "El renderer devuelve los bytes reales del PDF ademas de escribir build/*.pdf."
      },
      {
        name: "Artefacto",
        body: "La UI sirve el PDF por /artifact para verlo sin salir del navegador local."
      }
    ]
  };
}

function countPdfPages(bytes: Buffer): number {
  return bytes.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

function sendJson(response: http.ServerResponse, payload: unknown, status = 200): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function sendHtml(response: http.ServerResponse, html: string): void {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

function pageHtml(): string {
  return String.raw`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KUI Compiler Inspector</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #14171f;
      --muted: #667085;
      --line: #d9dee8;
      --paper: #f7f8fa;
      --panel: #ffffff;
      --navy: #1d2a44;
      --rust: #c05a2b;
      --green: #16794d;
      --gold: #a06500;
      --code: #101828;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial Narrow, Arial, Helvetica, sans-serif;
      color: var(--ink);
      background: var(--paper);
    }
    header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 18px;
      align-items: end;
      padding: 24px 28px 18px;
      border-bottom: 1px solid var(--line);
      background: #fff;
    }
    h1 { margin: 0; font-size: 30px; line-height: 1; letter-spacing: 0; }
    header p { margin: 8px 0 0; color: var(--muted); max-width: 760px; font-size: 15px; }
    header > div:last-child { min-width: 280px; }
    main {
      display: grid;
      grid-template-columns: minmax(320px, 0.9fr) minmax(420px, 1.25fr);
      min-height: calc(100vh - 98px);
    }
    aside {
      padding: 18px;
      border-right: 1px solid var(--line);
      background: #fff;
      overflow: auto;
    }
    section { padding: 18px; overflow: auto; }
    label { display: block; color: var(--muted); font-size: 12px; text-transform: uppercase; font-weight: 700; margin-bottom: 6px; }
    select, button {
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
      font: inherit;
      padding: 8px 10px;
    }
    button {
      cursor: pointer;
      border-color: var(--navy);
      background: var(--navy);
      color: #fff;
      font-weight: 700;
      margin-top: 10px;
    }
    button.secondary {
      background: #fff;
      color: var(--navy);
    }
    .band {
      border: 1px solid var(--line);
      background: var(--panel);
      margin-bottom: 14px;
    }
    .band h2 {
      margin: 0;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      font-size: 16px;
      background: #fbfcfe;
    }
    .band .body { padding: 12px; }
    .pipeline {
      display: grid;
      gap: 8px;
    }
    .step {
      display: grid;
      grid-template-columns: 26px 1fr;
      gap: 9px;
      align-items: start;
      padding: 9px;
      border: 1px solid var(--line);
      background: #fff;
    }
    .dot {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      background: var(--rust);
      color: #fff;
      font-weight: 700;
      font-size: 12px;
    }
    .step strong { display: block; font-size: 14px; }
    .step code { display: block; margin: 3px 0; color: var(--rust); }
    .step span { color: var(--muted); font-size: 13px; }
    .guide-grid,
    .module-grid,
    .syntax-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .guide-card,
    .module-card,
    .syntax-row,
    .template-box {
      border: 1px solid var(--line);
      background: #fff;
      padding: 11px;
    }
    .guide-card strong,
    .module-card strong,
    .syntax-row strong,
    .template-box strong {
      display: block;
      font-size: 15px;
      margin-bottom: 5px;
    }
    .guide-card p,
    .module-card p,
    .syntax-row p,
    .template-box p {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
    }
    .module-card code,
    .syntax-row code {
      display: inline-block;
      color: var(--rust);
      background: #fff7ed;
      padding: 2px 5px;
      margin: 2px 0 7px;
      font-size: 12px;
    }
    .module-meta {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--line);
      color: var(--ink);
      font-size: 13px;
    }
    .pill-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 9px;
    }
    .pill {
      border: 1px solid var(--line);
      background: #f8fafc;
      color: var(--ink);
      padding: 4px 7px;
      font-size: 12px;
      font-weight: 700;
    }
    .margin-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      margin-top: 9px;
    }
    .margin-grid div {
      background: #f2f4f7;
      padding: 7px;
      font-size: 12px;
    }
    .model-section h3 {
      margin: 4px 0 10px;
      font-size: 15px;
    }
    .inline-pre {
      max-height: none;
      margin-top: 8px;
      background: #f2f4f7;
      color: var(--ink);
      white-space: pre-wrap;
    }
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      border-bottom: 1px solid var(--line);
      margin-bottom: 12px;
    }
    .tab {
      width: auto;
      margin: 0;
      border: 0;
      background: transparent;
      color: var(--muted);
      padding: 9px 11px;
    }
    .tab.active {
      color: var(--ink);
      border-bottom: 3px solid var(--rust);
    }
    pre {
      margin: 0;
      padding: 12px;
      overflow: auto;
      background: var(--code);
      color: #eef4ff;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      max-height: 62vh;
      white-space: pre-wrap;
    }
    .kv {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .metric {
      border-left: 4px solid var(--rust);
      background: #fff;
      border-top: 1px solid var(--line);
      border-right: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      padding: 9px;
    }
    .metric b { display: block; font-size: 22px; }
    .metric span { color: var(--muted); font-size: 12px; }
    .diagnostics {
      display: grid;
      gap: 8px;
    }
    .diag {
      padding: 8px 10px;
      border-left: 4px solid var(--green);
      background: #f4fbf7;
      font-size: 13px;
    }
    .diag.error { border-color: #d92d20; background: #fff5f5; }
    .diag.warning { border-color: var(--gold); background: #fffbeb; }
    iframe {
      width: 100%;
      height: 68vh;
      border: 1px solid var(--line);
      background: #fff;
    }
    .muted { color: var(--muted); }
    .commands code {
      display: block;
      padding: 8px;
      background: #f2f4f7;
      margin: 6px 0;
      overflow: auto;
    }
    @media (max-width: 960px) {
      header, main { display: block; }
      aside { border-right: 0; border-bottom: 1px solid var(--line); }
      .kv { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .guide-grid, .module-grid, .syntax-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>KUI Compiler Inspector</h1>
      <p>Una vista local del compilador: fuente KUI, AST resumido, diagnosticos, pipeline y PDF nativo generado sin LaTeX.</p>
    </div>
    <div>
      <label for="example">Documento</label>
      <select id="example"></select>
      <button id="compile">Compilar PDF nativo</button>
      <button class="secondary" id="refresh">Releer KUI</button>
    </div>
  </header>
  <main>
    <aside>
      <div class="band">
        <h2>Pipeline</h2>
        <div class="body pipeline" id="pipeline"></div>
      </div>
      <div class="band">
        <h2>Plantilla y margenes</h2>
        <div class="body" id="template"></div>
      </div>
      <div class="band">
        <h2>Comandos equivalentes</h2>
        <div class="body commands" id="commands"></div>
      </div>
      <div class="band">
        <h2>Diagnosticos</h2>
        <div class="body diagnostics" id="diagnostics"></div>
      </div>
    </aside>
    <section>
      <div class="band">
        <h2>Estado del documento</h2>
        <div class="body">
          <div class="kv" id="stats"></div>
        </div>
      </div>
      <div class="band">
        <h2>Como compila KUI</h2>
        <div class="body">
          <div class="guide-grid" id="overview"></div>
        </div>
      </div>
      <div class="band">
        <h2>Explorador</h2>
        <div class="body">
          <div class="tabs">
            <button class="tab active" data-tab="architecture">Arquitectura</button>
            <button class="tab" data-tab="syntax">Sintaxis</button>
            <button class="tab" data-tab="model">Modelo</button>
            <button class="tab" data-tab="source">KUI</button>
            <button class="tab" data-tab="frontmatter">Frontmatter</button>
            <button class="tab" data-tab="ast">AST</button>
            <button class="tab" data-tab="symbols">Simbolos</button>
            <button class="tab" data-tab="pdf">PDF</button>
          </div>
          <div id="tab-architecture"><div class="module-grid" id="architecture"></div></div>
          <div id="tab-syntax" hidden><div class="syntax-grid" id="syntax"></div></div>
          <div id="tab-model" hidden><div class="model-section" id="model"></div></div>
          <div id="tab-source" hidden><pre id="source"></pre></div>
          <div id="tab-frontmatter" hidden><pre id="frontmatter"></pre></div>
          <div id="tab-ast" hidden><pre id="ast"></pre></div>
          <div id="tab-symbols" hidden><pre id="symbols"></pre></div>
          <div id="tab-pdf" hidden>
            <p class="muted" id="pdf-status">Compila para ver el PDF aqui.</p>
            <iframe id="pdf-frame" title="PDF generado"></iframe>
          </div>
        </div>
      </div>
    </section>
  </main>
  <script>
    const state = { file: "", inspect: null };
    const example = document.querySelector("#example");
    const compileButton = document.querySelector("#compile");
    const refreshButton = document.querySelector("#refresh");

    document.querySelectorAll(".tab").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
        button.classList.add("active");
        for (const name of ["architecture", "syntax", "model", "source", "frontmatter", "ast", "symbols", "pdf"]) {
          document.querySelector("#tab-" + name).hidden = button.dataset.tab !== name;
        }
      });
    });

    async function init() {
      const payload = await fetchJson("/api/examples");
      example.innerHTML = payload.examples.map((item) => "<option>" + escapeHtml(item) + "</option>").join("");
      example.value = payload.examples.includes("examples/academico-completo.kui")
        ? "examples/academico-completo.kui"
        : payload.examples[0];
      state.file = example.value;
      await inspect();
    }

    async function inspect() {
      state.file = example.value;
      const payload = await fetchJson("/api/inspect?file=" + encodeURIComponent(state.file));
      state.inspect = payload;
      document.querySelector("#source").textContent = payload.source;
      document.querySelector("#frontmatter").textContent = JSON.stringify(payload.frontmatter, null, 2);
      document.querySelector("#ast").textContent = JSON.stringify(payload.ast, null, 2);
      document.querySelector("#symbols").textContent = JSON.stringify(payload.symbols, null, 2);
      renderTemplate(payload.template);
      renderGuide(payload.guide);
      renderArchitecture(payload.guide.modules || []);
      renderSyntax(payload.guide.syntax || []);
      renderModel(payload.guide.dataModel || [], payload.guide.outputs || []);
      renderPipeline(payload.pipeline);
      renderCommands(payload.commands);
      renderDiagnostics(payload.diagnostics);
      renderStats(payload);
    }

    async function compilePdf() {
      compileButton.disabled = true;
      compileButton.textContent = "Compilando...";
      try {
        const payload = await fetchJson("/api/compile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: state.file })
        });
        renderDiagnostics(payload.diagnostics || []);
        if (payload.ok) {
          const mb = (payload.byteLength / 1024 / 1024).toFixed(3);
          document.querySelector("#pdf-status").textContent = payload.pdfPath + " | " + mb + " MB | " + payload.pageCount + " paginas | " + payload.byteLength + " bytes";
          document.querySelector("#pdf-frame").src = payload.pdfUrl + "&t=" + Date.now();
          activateTab("pdf");
        }
      } finally {
        compileButton.disabled = false;
        compileButton.textContent = "Compilar PDF nativo";
      }
    }

    function activateTab(name) {
      document.querySelector('.tab[data-tab="' + name + '"]').click();
    }

    function renderPipeline(items) {
      document.querySelector("#pipeline").innerHTML = items.map((item, index) => (
        '<div class="step"><div class="dot">' + (index + 1) + '</div><div><strong>' +
        escapeHtml(item.step.replace(/^\\d+\\.\\s*/, "")) + '</strong><code>' +
        escapeHtml(item.module) + '</code><span>' + escapeHtml(item.note) + '</span></div></div>'
      )).join("");
    }

    function renderTemplate(template) {
      const margins = template.margins || {};
      const support = Object.entries(template.supports || {})
        .filter(([, enabled]) => enabled)
        .map(([name]) => '<span class="pill">' + escapeHtml(name) + '</span>')
        .join("");
      const fields = (template.requiredFields || [])
        .map((field) => '<span class="pill">' + escapeHtml(field) + '</span>')
        .join("");
      document.querySelector("#template").innerHTML =
        '<div class="template-box"><strong>' + escapeHtml(template.name || template.id) + '</strong>' +
        '<p>Engine: ' + escapeHtml(template.pdfEngine || "native") + ' | Fuente: ' + escapeHtml(template.fontFamily || "Arial Narrow") + '</p>' +
        '<div class="margin-grid">' +
        '<div>Top: <b>' + escapeHtml(Number(margins.top || 0).toFixed(1)) + ' pt</b></div>' +
        '<div>Right: <b>' + escapeHtml(Number(margins.right || 0).toFixed(1)) + ' pt</b></div>' +
        '<div>Bottom: <b>' + escapeHtml(Number(margins.bottom || 0).toFixed(1)) + ' pt</b></div>' +
        '<div>Left: <b>' + escapeHtml(Number(margins.left || 0).toFixed(1)) + ' pt</b></div>' +
        '<div>Ancho util: <b>' + escapeHtml(Number(margins.usableWidth || 0).toFixed(1)) + ' pt</b></div>' +
        '<div>Alto util: <b>' + escapeHtml(Number(margins.usableHeight || 0).toFixed(1)) + ' pt</b></div>' +
        '</div><p style="margin-top:9px">' + escapeHtml(margins.note || "") + '</p>' +
        '<label style="margin-top:10px">Campos requeridos</label><div class="pill-row">' + (fields || '<span class="muted">Ninguno</span>') + '</div>' +
        '<label style="margin-top:10px">Soportes activos</label><div class="pill-row">' + (support || '<span class="muted">Ninguno</span>') + '</div></div>';
    }

    function renderGuide(guide) {
      document.querySelector("#overview").innerHTML = (guide.overview || []).map((item) =>
        '<div class="guide-card"><strong>' + escapeHtml(item.title) + '</strong><p>' + escapeHtml(item.body) + '</p></div>'
      ).join("");
    }

    function renderArchitecture(modules) {
      document.querySelector("#architecture").innerHTML = modules.map((item) =>
        '<article class="module-card"><strong>' + escapeHtml(item.name) + '</strong><code>' + escapeHtml(item.file) +
        '</code><p>' + escapeHtml(item.does) + '</p><div class="module-meta"><b>Salida:</b> ' +
        escapeHtml(item.output) + '</div></article>'
      ).join("");
    }

    function renderSyntax(items) {
      document.querySelector("#syntax").innerHTML = items.map((item) =>
        '<article class="syntax-row"><strong>' + escapeHtml(item.token) + '</strong><p>' +
        escapeHtml(item.purpose) + '</p><pre class="inline-pre">' + escapeHtml(item.example) + '</pre></article>'
      ).join("");
    }

    function renderModel(dataModel, outputs) {
      const nodes = dataModel.map((item) =>
        '<article class="module-card"><strong>' + escapeHtml(item.name) + '</strong><code>' + escapeHtml(item.fields) +
        '</code><p>' + escapeHtml(item.why) + '</p></article>'
      ).join("");
      const renderedOutputs = outputs.map((item) =>
        '<article class="module-card"><strong>' + escapeHtml(item.name) + '</strong><p>' + escapeHtml(item.body) + '</p></article>'
      ).join("");
      document.querySelector("#model").innerHTML =
        '<h3>Nodos internos</h3><div class="module-grid">' + nodes +
        '</div><h3 style="margin-top:16px">Salidas del compilador</h3><div class="module-grid">' + renderedOutputs + '</div>';
    }

    function renderCommands(commands) {
      document.querySelector("#commands").innerHTML = Object.entries(commands).map(([name, value]) =>
        '<label>' + escapeHtml(name) + '</label><code>' + escapeHtml(value) + '</code>'
      ).join("");
    }

    function renderDiagnostics(diagnostics) {
      const target = document.querySelector("#diagnostics");
      if (!diagnostics.length) {
        target.innerHTML = '<div class="diag">Sin diagnosticos.</div>';
        return;
      }
      target.innerHTML = diagnostics.map((item) => (
        '<div class="diag ' + escapeHtml(item.severity) + '"><b>' + escapeHtml(item.severity.toUpperCase()) +
        ' ' + escapeHtml(item.code) + '</b><br>' + escapeHtml(item.message) +
        (item.position ? '<br><span class="muted">' + escapeHtml((item.position.file || "") + ":" + item.position.line + ":" + item.position.column) + '</span>' : '') +
        '</div>'
      )).join("");
    }

    function renderStats(payload) {
      const stats = payload.stats || {};
      const items = [
        ["Bloques", Object.values(stats).reduce((sum, value) => sum + value, 0)],
        ["Tablas", stats.Table || 0],
        ["Bloques semanticos", (payload.ast || []).filter((item) => item.kind === "FencedDiv").length],
        ["Labels", payload.symbols.labels.length],
        ["Citas", payload.symbols.citations.length],
        ["Includes", payload.includedFiles.length]
      ];
      document.querySelector("#stats").innerHTML = items.map(([label, value]) =>
        '<div class="metric"><b>' + escapeHtml(String(value)) + '</b><span>' + escapeHtml(label) + '</span></div>'
      ).join("");
    }

    async function fetchJson(url, options) {
      const response = await fetch(url, options);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Error HTTP " + response.status);
      return payload;
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }

    example.addEventListener("change", inspect);
    refreshButton.addEventListener("click", inspect);
    compileButton.addEventListener("click", compilePdf);
    init().catch((error) => {
      document.body.innerHTML = "<pre>" + escapeHtml(error.stack || error.message) + "</pre>";
    });
  </script>
</body>
</html>`;
}
