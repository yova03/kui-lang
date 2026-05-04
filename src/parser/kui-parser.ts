import {
  attributesFromAliases,
  directiveAliases,
  fencedDivAliases,
  parseAttributes
} from "./aliases.js";
import { readFrontmatter } from "./frontmatter.js";
import {
  createEmptySymbols,
  emptyAttributes,
  type Attributes,
  type BlockNode,
  type CitationNode,
  type CrossRefNode,
  type DocumentNode,
  type FigureNode,
  type FencedDivNode,
  type FrontmatterNode,
  type HeadingNode,
  type InlineNode,
  type ListItemNode,
  type ListNode,
  type ParagraphNode,
  type TableNode
} from "../core/ast.js";
import { DiagnosticBag, type SourcePosition } from "../core/diagnostics.js";

interface ParserLine {
  text: string;
  number: number;
  offset: number;
}

interface ParseContext {
  file?: string;
  diagnostics: DiagnosticBag;
  usedIds: Set<string>;
}

export interface ParseOptions {
  file?: string;
}

const EASY_COMMAND_NAMES = new Set([
  "resumen",
  "nota",
  "aviso",
  "warning",
  "pendiente",
  "todo",
  "caja",
  "tabla",
  "table",
  "kpis",
  "indicadores",
  "kpi-grid",
  "semaforo",
  "semáforo",
  "cronograma",
  "firma",
  "firmas",
  "cuadrado",
  "square",
  "circulo",
  "círculo",
  "circle",
  "triangulo",
  "triángulo",
  "triangle",
  "plano",
  "plano-cartesiano",
  "plano-coordenadas",
  "coordenadas",
  "poligono",
  "polígono"
]);

const SIMPLE_COMMAND_NAMES = new Set([
  ...EASY_COMMAND_NAMES,
  "img",
  "image",
  "imagen",
  "figura",
  "figure",
  "grafico",
  "gráfico",
  "graficos",
  "gráficos",
  "barras",
  "chart",
  "bar-chart",
  "formula",
  "fórmula",
  "ecuacion",
  "ecuación"
]);

export function parseKui(source: string, options: ParseOptions = {}): DocumentNode {
  const frontmatter = readFrontmatter(source, options.file);
  const diagnostics = new DiagnosticBag();
  diagnostics.merge(frontmatter.diagnostics);

  const bodyStartLine = countLines(source.slice(0, source.length - frontmatter.body.length)) + 1;
  const lines = toLines(frontmatter.body, bodyStartLine);
  const ctx: ParseContext = { file: options.file, diagnostics, usedIds: new Set() };
  const parser = new BlockParser(lines, ctx);
  const children = parser.parseBlocks();
  const documentFrontmatter = applyDocumentDefaults(frontmatter.frontmatter, children, options.file);
  const document: DocumentNode = {
    kind: "Document",
    frontmatter: documentFrontmatter,
    children,
    diagnostics: diagnostics.diagnostics,
    symbols: createEmptySymbols(),
    sourceFiles: options.file ? [options.file] : []
  };
  collectSymbols(document);
  return document;
}

function applyDocumentDefaults(frontmatter: FrontmatterNode | undefined, children: BlockNode[], file?: string): FrontmatterNode {
  const data = { ...(frontmatter?.data ?? {}) };
  const templateWasMissing = !hasMetadataValue(data.template);

  if (templateWasMissing) data.template = "paper-APA";
  if (!hasMetadataValue(data.title)) data.title = firstHeadingTitle(children) ?? "Documento KUI";
  if (templateWasMissing && !hasMetadataValue(data.author)) data.author = "Autor no declarado";

  return {
    kind: "Frontmatter",
    raw: frontmatter?.raw ?? "",
    data,
    position: frontmatter?.position ?? { file, line: 1, column: 1 }
  };
}

function firstHeadingTitle(children: BlockNode[]): string | undefined {
  for (const child of children) {
    if (child.kind === "Heading") {
      const title = plainInlineText(child.title).trim();
      if (title) return title;
    }
  }
  return undefined;
}

function hasMetadataValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

class BlockParser {
  private index = 0;

  constructor(
    private readonly lines: ParserLine[],
    private readonly ctx: ParseContext
  ) {}

  parseBlocks(stopFence = false): BlockNode[] {
    const blocks: BlockNode[] = [];

    while (this.index < this.lines.length) {
      const line = this.current();
      if (!line) break;
      if (stopFence && line.text.trim() === ":::") {
        this.index++;
        break;
      }
      if (line.text.trim() === "") {
        this.index++;
        continue;
      }
      if (this.skipComment()) continue;

      const parsed =
        this.parseHorizontalRule() ??
        this.parseCodeBlock() ??
        this.parseMathBlock() ??
        this.parseFormulaCommand() ??
        this.parseFencedDiv() ??
        this.parseImageCommand() ??
        this.parseChartCommand() ??
        this.parseEasyCommand() ??
        this.parseDirective() ??
        this.parseFootnoteDef() ??
        this.parseHeading() ??
        this.parseFigure() ??
        this.parseTable() ??
        this.parseList() ??
        this.parseBlockquote() ??
        this.parseParagraph();

      if (parsed) blocks.push(parsed);
    }

    return blocks;
  }

  private current(): ParserLine | undefined {
    return this.lines[this.index];
  }

  private skipComment(): boolean {
    const line = this.current();
    if (!line) return false;
    const trimmed = line.text.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("%")) {
      this.index++;
      return true;
    }
    if (!trimmed.startsWith("<!--")) return false;

    this.index++;
    if (trimmed.includes("-->")) return true;
    while (this.index < this.lines.length) {
      const current = this.current();
      this.index++;
      if (!current || current.text.includes("-->")) break;
    }
    return true;
  }

  private parseHorizontalRule(): BlockNode | undefined {
    const line = this.current();
    if (!line) return undefined;
    if (!/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line.text)) return undefined;
    this.index++;
    return { kind: "HorizontalRule", position: position(line, this.ctx.file) };
  }

  private parseCodeBlock(): BlockNode | undefined {
    const start = this.current();
    if (!start) return undefined;
    const match = start.text.match(/^```(\S+)?\s*(\{.*\})?\s*$/);
    if (!match) return undefined;
    const language = match[1];
    const attrs = parseAttributes(match[2]);
    const content: string[] = [];
    this.index++;

    while (this.index < this.lines.length) {
      const line = this.current();
      if (!line) break;
      if (line.text.trim() === "```") {
        this.index++;
        return {
          kind: "CodeBlock",
          language,
          content: content.join("\n"),
          attrs,
          position: position(start, this.ctx.file)
        };
      }
      content.push(line.text);
      this.index++;
    }

    this.ctx.diagnostics.error("KUI-E012", "Bloque de código sin cierre ```.", position(start, this.ctx.file));
    return {
      kind: "CodeBlock",
      language,
      content: content.join("\n"),
      attrs,
      position: position(start, this.ctx.file)
    };
  }

  private parseMathBlock(): BlockNode | undefined {
    const start = this.current();
    if (!start || !start.text.trim().startsWith("$$")) return undefined;
    const first = start.text.trim();
    const sameLine = first.match(/^\$\$(.*)\$\$\s*(\{.*\})?\s*$/);
    if (sameLine && sameLine[1].trim() !== "") {
      this.index++;
      return {
        kind: "MathBlock",
        content: sameLine[1].trim(),
        attrs: parseAttributes(sameLine[2]),
        position: position(start, this.ctx.file)
      };
    }

    const content: string[] = [];
    this.index++;
    while (this.index < this.lines.length) {
      const line = this.current();
      if (!line) break;
      const close = line.text.trim().match(/^\$\$\s*(\{.*\})?\s*$/);
      if (close) {
        this.index++;
        return {
          kind: "MathBlock",
          content: content.join("\n"),
          attrs: parseAttributes(close[1]),
          position: position(start, this.ctx.file)
        };
      }
      content.push(line.text);
      this.index++;
    }

    this.ctx.diagnostics.error("KUI-E013", "Bloque matemático sin cierre $$.", position(start, this.ctx.file));
    return {
      kind: "MathBlock",
      content: content.join("\n"),
      attrs: emptyAttributes(),
      position: position(start, this.ctx.file)
    };
  }

  private parseFormulaCommand(): BlockNode | undefined {
    const line = this.current();
    if (!line) return undefined;
    const match = line.text.match(/^:?(formula|fórmula|ecuacion|ecuación)\s+(.+?)(?:\s+(\{.*\}))?\s*$/i);
    if (!match) return undefined;

    this.index++;
    const content = match[2].trim();
    const attrs = parseAttributes(match[3]);
    if (attrs.id) this.reserveId(attrs.id);
    else attrs.id = this.autoId("eq", content);
    return {
      kind: "MathBlock",
      content,
      attrs,
      position: position(line, this.ctx.file)
    };
  }

  private parseFencedDiv(): BlockNode | undefined {
    const start = this.current();
    if (!start) return undefined;
    const match = start.text.match(/^:::\s*([^\s{]+)?\s*([^{]*)?(\{.*\})?\s*$/);
    if (!match || start.text.trim() === ":::") return undefined;

    const rawName = match[1] ?? "div";
    const aliasText = (match[2] ?? "").trim();
    const aliases = aliasText ? aliasText.split(/\s+/) : [];
    const attrs = mergeAttributes(parseAttributes(match[3]), attributesFromAliases([rawName, ...aliases]));
    const canonicalName = fencedDivAliases[rawName.toLowerCase()] ?? rawName;
    if (canonicalName === "shape" && !attrs.normalized.type) {
      attrs.normalized.type = attrs.aliases.map((alias) => alias.toLowerCase()).find((alias) =>
        ["square", "circle", "triangle", "cuadrado", "circulo", "círculo", "triangulo", "triángulo"].includes(alias)
      ) ?? rawName;
    }

    this.index++;
    const children = this.parseBlocks(true);
    const closed = this.lines[this.index - 1]?.text.trim() === ":::";
    if (!closed) {
      this.ctx.diagnostics.error("KUI-E001", `El bloque :::${rawName} no tiene cierre.`, position(start, this.ctx.file));
    }
    const node: FencedDivNode = {
      kind: "FencedDiv",
      name: rawName,
      canonicalName,
      attrs,
      children,
      position: position(start, this.ctx.file)
    };
    return node;
  }

  private parseDirective(): BlockNode | undefined {
    const line = this.current();
    if (!line) return undefined;
    const match = line.text.match(/^(:?)([A-Za-zÁÉÍÓÚÜÑáéíóúüñ_-]+)(?:\s+(.*))?\s*$/);
    if (!match) return undefined;
    const hasColon = match[1] === ":";
    const rawName = match[2];
    const canonical = directiveAliases[rawName.toLowerCase()] ?? "unknown";
    if (canonical === "unknown") {
      if (!hasColon) return undefined;
      this.ctx.diagnostics.error("KUI-E003", `Directiva desconocida :${rawName}.`, position(line, this.ctx.file));
    }
    this.index++;
    return {
      kind: "Directive",
      rawName,
      name: canonical as never,
      args: match[3] ?? "",
      position: position(line, this.ctx.file)
    };
  }

  private parseFootnoteDef(): BlockNode | undefined {
    const line = this.current();
    if (!line) return undefined;
    const match = line.text.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
    if (!match) return undefined;
    this.index++;
    return {
      kind: "FootnoteDef",
      id: match[1],
      children: parseInline(match[2], position(line, this.ctx.file), this.ctx.diagnostics),
      position: position(line, this.ctx.file)
    };
  }

  private parseHeading(): BlockNode | undefined {
    const line = this.current();
    if (!line) return undefined;
    const match = line.text.match(/^(#{1,6})\s+(.+?)\s*(\{.*\})?\s*$/);
    if (!match) return undefined;
    this.index++;
    const attrs = parseAttributes(match[3]);
    const level = match[1].length as 1 | 2 | 3 | 4 | 5 | 6;
    const title = match[2].replace(/\s+\{.*\}\s*$/, "");
    if (attrs.id) this.reserveId(attrs.id);
    else attrs.id = this.autoId("sec", title);
    const node: HeadingNode = {
      kind: "Heading",
      level,
      title: parseInline(title, position(line, this.ctx.file), this.ctx.diagnostics),
      attrs,
      canonicalRole: headingRole(level, attrs),
      position: position(line, this.ctx.file)
    };
    return node;
  }

  private parseFigure(): BlockNode | undefined {
    const line = this.current();
    if (!line) return undefined;
    const match = line.text.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*(\{.*\})?\s*$/);
    if (!match) return undefined;
    this.index++;
    const alt = match[1];
    const attrs = parseAttributes(match[3]);
    if (attrs.id) this.reserveId(attrs.id);
    else attrs.id = this.autoId("fig", pathBasenameWithoutExtension(match[2]));
    const figure: FigureNode = {
      kind: "Figure",
      alt,
      caption: parseInline(alt, position(line, this.ctx.file), this.ctx.diagnostics),
      path: match[2],
      attrs,
      position: position(line, this.ctx.file)
    };
    return figure;
  }

  private parseImageCommand(): BlockNode | undefined {
    const line = this.current();
    if (!line) return undefined;
    const match = line.text.match(/^:?(img|image|imagen|figura|figure)\s+(.+?)\s*$/i);
    if (!match) return undefined;

    const parsed = parseImageCommandArgs(match[2]);
    this.index++;
    if (!parsed.path) {
      this.ctx.diagnostics.error(
        "KUI-E014",
        "La imagen necesita un archivo o nombre.",
        position(line, this.ctx.file),
        "Ejemplo: imagen kui-logo | Logo de KUI"
      );
      return {
        kind: "Figure",
        alt: "",
        caption: [],
        path: "",
        attrs: emptyAttributes(),
        position: position(line, this.ctx.file)
      };
    }

    const attrs = parsed.attrs;
    if (attrs.id) this.reserveId(attrs.id);
    else attrs.id = this.autoId("fig", pathBasenameWithoutExtension(parsed.path));
    const caption = parsed.caption || defaultFigureCaption(parsed.path);
    return {
      kind: "Figure",
      alt: caption,
      caption: parseInline(caption, position(line, this.ctx.file), this.ctx.diagnostics),
      path: parsed.path,
      attrs,
      position: position(line, this.ctx.file)
    };
  }

  private parseChartCommand(): BlockNode | undefined {
    const line = this.current();
    if (!line) return undefined;
    const match = line.text.match(/^:?(grafico|gráfico|graficos|gráficos|barras|chart|bar-chart)\s+(.+?)\s*$/i);
    if (!match) return undefined;

    const parsed = parseChartCommandArgs(match[2]);
    this.index++;
    if (parsed.items.length === 0) {
      this.ctx.diagnostics.error(
        "KUI-E015",
        "El grafico necesita datos separados por barras verticales.",
        position(line, this.ctx.file),
        "Ejemplo: grafico Permanencia | Ciclo 1=98.6 | Ciclo 2=96.1"
      );
    }

    const attrs = parsed.attrs;
    attrs.kv.title ??= parsed.title;
    attrs.normalized.title ??= parsed.title;
    const items: ListItemNode[] = parsed.items.map((item) => ({
      kind: "ListItem",
      children: parseInline(item, position(line, this.ctx.file), this.ctx.diagnostics),
      position: position(line, this.ctx.file)
    }));
    const list: ListNode = {
      kind: "List",
      ordered: false,
      task: false,
      items,
      position: position(line, this.ctx.file)
    };
    return {
      kind: "FencedDiv",
      name: match[1],
      canonicalName: "bar-chart",
      attrs,
      children: [list],
      position: position(line, this.ctx.file)
    };
  }

  private parseEasyCommand(): BlockNode | undefined {
    const line = this.current();
    if (!line) return undefined;
    const match = line.text.match(/^:?([A-Za-zÁÉÍÓÚÜÑáéíóúüñ_-]+)\s+(.+?)\s*$/);
    if (!match) return undefined;
    const rawName = match[1].toLowerCase();
    const args = match[2];
    const pos = position(line, this.ctx.file);
    if (!EASY_COMMAND_NAMES.has(rawName)) return undefined;

    if (["resumen", "nota", "aviso", "warning", "pendiente", "todo", "caja"].includes(rawName)) {
      this.index++;
      const canonical: Record<string, string> = {
        resumen: "abstract",
        nota: "note",
        aviso: "warning",
        warning: "warning",
        pendiente: "todo",
        todo: "todo",
        caja: "box"
      };
      return this.easyFencedDiv(rawName, canonical[rawName] ?? rawName, args, pos);
    }

    if (["tabla", "table"].includes(rawName)) {
      this.index++;
      if (!args.includes("|")) return this.easyMultilineTable(args, pos);
      return this.easyTable(args, pos);
    }

    if (["kpis", "indicadores", "kpi-grid", "semaforo", "semáforo", "cronograma", "firma", "firmas"].includes(rawName)) {
      this.index++;
      const canonical: Record<string, string> = {
        kpis: "kpi-grid",
        indicadores: "kpi-grid",
        "kpi-grid": "kpi-grid",
        semaforo: "status-grid",
        "semáforo": "status-grid",
        cronograma: "timeline",
        firma: "signature",
        firmas: "signature"
      };
      const parsed = parseTitledItems(args);
      return this.easyListFencedDiv(rawName, canonical[rawName] ?? rawName, parsed.title, parsed.items, pos);
    }

    if (["plano", "plano-cartesiano", "plano-coordenadas", "coordenadas", "poligono", "polígono"].includes(rawName)) {
      this.index++;
      if (args.includes("|")) return this.easyCoordinatePlane(rawName, args, pos);
      return this.easyMultilineCoordinatePlane(rawName, args, pos);
    }

    if (["cuadrado", "square", "circulo", "círculo", "circle", "triangulo", "triángulo", "triangle"].includes(rawName)) {
      this.index++;
      const parsed = parseShapeCommandArgs(args);
      const attrs = shapeAttributes(rawName, parsed.options);
      return {
        kind: "FencedDiv",
        name: rawName,
        canonicalName: "shape",
        attrs,
        children: [this.paragraph(parsed.text, pos)],
        position: pos
      };
    }

    return undefined;
  }

  private parseTable(): BlockNode | undefined {
    const start = this.current();
    if (!start || !isTableRow(start.text)) return undefined;
    const next = this.lines[this.index + 1];
    if (!next || !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(next.text)) return undefined;

    const header = splitTableRow(start.text);
    const alignments = splitTableAlignments(next.text);
    this.index += 2;
    const rows: string[][] = [];
    while (this.index < this.lines.length) {
      const line = this.current();
      if (!line || !isTableRow(line.text)) break;
      rows.push(splitTableRow(line.text));
      this.index++;
    }

    let caption: InlineNode[] | undefined;
    let attrs: Attributes | undefined;
    const maybeCaption = this.current();
    if (maybeCaption && maybeCaption.text.trim() !== ":::") {
      const captionMatch = maybeCaption.text.match(/^:\s*(.*?)\s*$/);
      if (captionMatch) {
        const parsedCaption = splitTrailingAttributes(captionMatch[1]);
        caption = parseInline(parsedCaption.text, position(maybeCaption, this.ctx.file), this.ctx.diagnostics);
        attrs = parseAttributes(parsedCaption.attrs);
        if (attrs.id) this.reserveId(attrs.id);
        else attrs.id = this.autoId("tbl", parsedCaption.text || "tabla");
        this.index++;
      }
    }

    attrs ??= emptyAttributes();
    if (!attrs.id) attrs.id = this.autoId("tbl", caption ? plainInlineText(caption) : "tabla");

    const table: TableNode = {
      kind: "Table",
      headers: header.map((cell) => parseInline(cell, position(start, this.ctx.file), this.ctx.diagnostics)),
      rows: rows.map((row) => row.map((cell) => parseInline(cell, position(start, this.ctx.file), this.ctx.diagnostics))),
      caption,
      alignments,
      attrs,
      position: position(start, this.ctx.file)
    };
    return table;
  }

  private parseList(): BlockNode | undefined {
    const start = this.current();
    if (!start) return undefined;
    const first = start.text.match(/^(\s*)([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?(.+)$/);
    if (!first) return undefined;

    const ordered = /\d+\./.test(first[2]);
    const items: ListItemNode[] = [];
    while (this.index < this.lines.length) {
      const line = this.current();
      if (!line) break;
      const match = line.text.match(/^(\s*)([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?(.+)$/);
      if (!match) break;
      const taskMarker = match[3];
      items.push({
        kind: "ListItem",
        checked: taskMarker ? /x/i.test(taskMarker) : undefined,
        children: parseInline(match[4], position(line, this.ctx.file), this.ctx.diagnostics),
        position: position(line, this.ctx.file)
      });
      this.index++;
    }

    const list: ListNode = {
      kind: "List",
      ordered,
      task: items.some((item) => item.checked !== undefined),
      items,
      position: position(start, this.ctx.file)
    };
    return list;
  }

  private parseBlockquote(): BlockNode | undefined {
    const start = this.current();
    if (!start || !start.text.startsWith(">")) return undefined;
    const quoteLines: string[] = [];
    while (this.index < this.lines.length) {
      const line = this.current();
      if (!line || !line.text.startsWith(">")) break;
      quoteLines.push(line.text.replace(/^>\s?/, ""));
      this.index++;
    }

    const callout = quoteLines[0]?.match(/^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION|TODO|MARGIN|COMMENT)\]\s*(.*)$/i);
    if (callout) {
      const body = [callout[2], ...quoteLines.slice(1)].filter(Boolean).join("\n");
      const parser = new BlockParser(toLines(body, start.number), this.ctx);
      return {
        kind: "Callout",
        calloutType: callout[1].toUpperCase() as never,
        children: parser.parseBlocks(),
        position: position(start, this.ctx.file)
      };
    }

    const parser = new BlockParser(toLines(quoteLines.join("\n"), start.number), this.ctx);
    return {
      kind: "Blockquote",
      children: parser.parseBlocks(),
      position: position(start, this.ctx.file)
    };
  }

  private parseParagraph(): BlockNode | undefined {
    const start = this.current();
    if (!start) return undefined;
    const chunks: string[] = [];
    while (this.index < this.lines.length) {
      const line = this.current();
      if (!line || line.text.trim() === "" || startsBlock(line.text)) break;
      chunks.push(line.text);
      this.index++;
    }
    if (chunks.length === 0) {
      this.index++;
      return undefined;
    }
    const paragraph: ParagraphNode = {
      kind: "Paragraph",
      children: parseInline(chunks.join("\n"), position(start, this.ctx.file), this.ctx.diagnostics),
      position: position(start, this.ctx.file)
    };
    return paragraph;
  }

  private easyFencedDiv(rawName: string, canonicalName: string, text: string, pos: SourcePosition): FencedDivNode {
    return {
      kind: "FencedDiv",
      name: rawName,
      canonicalName,
      attrs: emptyAttributes(),
      children: [this.paragraph(text, pos)],
      position: pos
    };
  }

  private easyListFencedDiv(rawName: string, canonicalName: string, title: string, items: string[], pos: SourcePosition): FencedDivNode {
    const attrs = emptyAttributes();
    attrs.kv.title = title;
    attrs.normalized.title = title;
    return {
      kind: "FencedDiv",
      name: rawName,
      canonicalName,
      attrs,
      children: [this.list(items, pos)],
      position: pos
    };
  }

  private easyTable(args: string, pos: SourcePosition): TableNode {
    const parsed = parseEasyTableArgs(args);
    const attrs = emptyAttributes();
    attrs.id = this.autoId("tbl", parsed.title);
    return {
      kind: "Table",
      headers: parsed.headers.map((cell) => parseInline(cell, pos, this.ctx.diagnostics)),
      rows: parsed.rows.map((row) => row.map((cell) => parseInline(cell, pos, this.ctx.diagnostics))),
      caption: parseInline(parsed.title, pos, this.ctx.diagnostics),
      attrs,
      position: pos
    };
  }

  private easyCoordinatePlane(rawName: string, args: string, pos: SourcePosition): FencedDivNode {
    const [rawTitle, ...rawItems] = splitChartCommandParts(args);
    return this.coordinatePlaneNode(rawName, rawTitle, rawItems, {}, pos);
  }

  private easyMultilineCoordinatePlane(rawName: string, titleArg: string, pos: SourcePosition): FencedDivNode {
    const rows: string[] = [];
    const options: Record<string, string> = {};
    while (this.index < this.lines.length) {
      const line = this.current();
      if (!line || line.text.trim() === "" || startsBlock(line.text)) break;
      const config = parseCoordinateConfigLine(line.text);
      if (config) {
        options[config.key] = config.value;
        this.index++;
        continue;
      }
      if (looksLikeCoordinateRow(line.text)) {
        rows.push(line.text);
        this.index++;
        continue;
      }
      break;
    }

    if (rows.length < 3) {
      this.ctx.diagnostics.error(
        "KUI-E017",
        "El plano necesita al menos tres puntos para formar un poligono.",
        pos,
        "Ejemplo: plano Mi predio\\nP1; 826340; 8502740\\nP2; 826520; 8502815\\nP3; 826430; 8502940"
      );
    }

    return this.coordinatePlaneNode(rawName, titleArg, rows, options, pos);
  }

  private coordinatePlaneNode(
    rawName: string,
    titleArg: string | undefined,
    rawItems: string[],
    options: Record<string, string>,
    pos: SourcePosition
  ): FencedDivNode {
    const attrs = emptyAttributes();
    const title = stripQuotes((titleArg ?? "Plano de coordenadas").trim()) || "Plano de coordenadas";
    const datum = options.datum ?? "WGS84";
    const zone = options.zone ?? options.zona ?? "18S";
    attrs.kv.title = title;
    attrs.normalized.title = title;
    attrs.kv.srid = `${datum} / UTM zona ${zone}`;
    attrs.normalized.srid = `${datum} / UTM zona ${zone}`;
    attrs.kv.datum = datum;
    attrs.normalized.datum = datum;
    attrs.kv.zone = zone;
    attrs.normalized.zone = zone;
    for (const [key, value] of Object.entries(options)) {
      attrs.kv[key] = value;
      attrs.normalized[key] = value;
    }
    const items = rawItems.map(normalizeCoordinateItem).filter(Boolean);
    return {
      kind: "FencedDiv",
      name: rawName,
      canonicalName: "coordinate-plane",
      attrs,
      children: [this.list(items, pos)],
      position: pos
    };
  }

  private easyMultilineTable(titleArg: string, pos: SourcePosition): TableNode {
    const title = stripQuotes(titleArg.trim()) || "Tabla";
    const rows: string[][] = [];

    while (this.index < this.lines.length) {
      const line = this.current();
      if (!line || line.text.trim() === "" || startsBlock(line.text)) break;
      if (!line.text.includes(";")) break;
      rows.push(splitSemicolonCells(line.text));
      this.index++;
    }

    if (rows.length === 0) {
      this.ctx.diagnostics.error(
        "KUI-E016",
        "La tabla multilínea necesita una cabecera y al menos una fila.",
        pos,
        "Ejemplo: tabla Resultados\\nCampo; Valor\\nCasos; 120"
      );
    } else if (rows.length === 1) {
      this.ctx.diagnostics.warning(
        "KUI-W016",
        "La tabla tiene cabecera, pero no tiene filas de datos.",
        pos,
        "Agrega una fila debajo, por ejemplo: Casos; 120"
      );
    }

    const attrs = emptyAttributes();
    attrs.id = this.autoId("tbl", title);
    const headers = rows[0] ?? ["Campo", "Valor"];
    const bodyRows = rows.slice(1);
    return {
      kind: "Table",
      headers: headers.map((cell) => parseInline(cell, pos, this.ctx.diagnostics)),
      rows: bodyRows.map((row) => row.map((cell) => parseInline(cell, pos, this.ctx.diagnostics))),
      caption: parseInline(title, pos, this.ctx.diagnostics),
      attrs,
      position: pos
    };
  }

  private paragraph(text: string, pos: SourcePosition): ParagraphNode {
    return {
      kind: "Paragraph",
      children: parseInline(text, pos, this.ctx.diagnostics),
      position: pos
    };
  }

  private list(items: string[], pos: SourcePosition): ListNode {
    return {
      kind: "List",
      ordered: false,
      task: false,
      items: items.map((item) => ({
        kind: "ListItem",
        children: parseInline(item, pos, this.ctx.diagnostics),
        position: pos
      })),
      position: pos
    };
  }

  private autoId(prefix: string, value: string): string {
    const base = `${prefix}:${slugify(value) || prefix}`;
    let candidate = base;
    let index = 2;
    while (this.ctx.usedIds.has(candidate)) {
      candidate = `${base}-${index}`;
      index++;
    }
    this.ctx.usedIds.add(candidate);
    return candidate;
  }

  private reserveId(id: string): void {
    this.ctx.usedIds.add(id);
  }
}

export function parseInline(text: string, basePosition: SourcePosition, diagnostics: DiagnosticBag): InlineNode[] {
  const nodes: InlineNode[] = [];
  const pattern =
    /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)(?:\{[^}]+\})?|!\[[^\]]*\]\([^)]+\)|\[\^[^\]]+\]|\[@[^\]]+\]|\$[^$\n]+\$|@(?:fig|tbl|eq|sec|def|thm):[A-Za-z0-9_:-]+(?:\.[A-Za-z0-9_:-]+)*|@[A-Za-z0-9_:-]+(?:\.[A-Za-z0-9_:-]+)*|\[[^\]]+\]\{[^}]+\}|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      nodes.push({ kind: "Text", value: text.slice(lastIndex, match.index), position: basePosition });
    }
    nodes.push(parseInlineToken(match[0], basePosition, diagnostics));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push({ kind: "Text", value: text.slice(lastIndex), position: basePosition });
  }
  return mergeAdjacentText(nodes);
}

function parseInlineToken(token: string, positionValue: SourcePosition, diagnostics: DiagnosticBag): InlineNode {
  if (token.startsWith("**")) {
    return { kind: "Bold", children: parseInline(token.slice(2, -2), positionValue, diagnostics), position: positionValue };
  }
  if (token.startsWith("*") && token.endsWith("*")) {
    return { kind: "Italic", children: parseInline(token.slice(1, -1), positionValue, diagnostics), position: positionValue };
  }
  if (token.startsWith("`")) {
    return { kind: "InlineCode", value: token.slice(1, -1), position: positionValue };
  }
  if (token.startsWith("$")) {
    return { kind: "MathInline", content: token.slice(1, -1), position: positionValue };
  }
  if (token.startsWith("![")) {
    const match = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    return { kind: "ImageInline", alt: match?.[1] ?? "", url: match?.[2] ?? "", position: positionValue };
  }
  if (token.startsWith("[@")) {
    return parseCitation(token, positionValue, diagnostics);
  }
  if (token.startsWith("@")) {
    const cleanToken = stripTrailingPunctuation(token);
    const ref = cleanToken.match(/^@(fig|tbl|eq|sec|def|thm):(.+)$/);
    if (ref) {
      const crossRef: CrossRefNode = {
        kind: "CrossRef",
        refType: ref[1] as never,
        id: `${ref[1]}:${ref[2]}`,
        position: positionValue
      };
      return crossRef;
    }
    const citation: CitationNode = {
      kind: "Citation",
      citationStyle: "intext",
      items: [{ key: cleanToken.slice(1) }],
      position: positionValue
    };
    return citation;
  }
  if (token.startsWith("[^")) {
    return { kind: "FootnoteRef", id: token.slice(2, -1), position: positionValue };
  }
  const span = token.match(/^\[([^\]]+)\](\{[^}]+\})$/);
  if (span) {
    return {
      kind: "Span",
      children: parseInline(span[1], positionValue, diagnostics),
      attrs: parseAttributes(span[2]),
      position: positionValue
    };
  }
  const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)(\{[^}]+\})?$/);
  if (link) {
    return {
      kind: "Link",
      children: parseInline(link[1], positionValue, diagnostics),
      url: link[2],
      attrs: parseAttributes(link[3]),
      position: positionValue
    };
  }
  return { kind: "Text", value: token, position: positionValue };
}

function parseCitation(token: string, positionValue: SourcePosition, diagnostics: DiagnosticBag): CitationNode {
  const body = token.slice(1, -1);
  const parts = body.split(";").map((part) => part.trim()).filter(Boolean);
  const items = parts.flatMap((part) => {
    const match = part.match(/^@([A-Za-z0-9_.:-]+)(?:,\s*(.+))?$/);
    if (!match) {
      diagnostics.error("KUI-E004", `Cita inválida: ${token}`, positionValue);
      return [];
    }
    return [{ key: match[1], locator: match[2] }];
  });
  return { kind: "Citation", citationStyle: "parenthetical", items, position: positionValue };
}

function collectSymbols(document: DocumentNode): void {
  const symbols = document.symbols;
  const visitInline = (node: InlineNode): void => {
    if (node.kind === "Citation") {
      for (const item of node.items) symbols.citations[item.key] = node.position;
    }
    if (node.kind === "CrossRef") {
      symbols.citations[`ref:${node.id}`] = node.position;
    }
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children as InlineNode[]) visitInline(child);
    }
  };
  const visitBlock = (node: BlockNode): void => {
    const id = node.attrs?.id;
    if (id) symbols.labels[id] = node.position;
    if (node.kind === "Figure") symbols.assets[node.path] = node.position;
    if (node.kind === "Figure" && node.attrs?.id) symbols.labels[node.attrs.id] = node.position;
    if (node.kind === "MathBlock" && node.attrs?.id) symbols.labels[node.attrs.id] = node.position;
    if (node.kind === "Table" && node.attrs?.id) symbols.labels[node.attrs.id] = node.position;

    if ("children" in node && Array.isArray(node.children)) {
      const children = node.children as Array<BlockNode | InlineNode>;
      for (const child of children) {
        if (isBlockNode(child)) visitBlock(child);
        else visitInline(child);
      }
    }
    if (node.kind === "Heading") node.title.forEach(visitInline);
    if (node.kind === "Figure") node.caption.forEach(visitInline);
    if (node.kind === "Table") {
      node.headers.flat().forEach(visitInline);
      node.rows.flat(2).forEach(visitInline);
      node.caption?.forEach(visitInline);
    }
    if (node.kind === "List") {
      for (const item of node.items) item.children.forEach(visitInline);
    }
  };
  document.children.forEach(visitBlock);
}

function isBlockNode(node: BlockNode | InlineNode): node is BlockNode {
  return [
    "Heading",
    "Paragraph",
    "List",
    "Blockquote",
    "Callout",
    "CodeBlock",
    "MathBlock",
    "Figure",
    "Table",
    "FencedDiv",
    "Directive",
    "FootnoteDef",
    "HorizontalRule"
  ].includes(node.kind);
}

function mergeAdjacentText(nodes: InlineNode[]): InlineNode[] {
  const merged: InlineNode[] = [];
  for (const node of nodes) {
    const previous = merged.at(-1);
    if (previous?.kind === "Text" && node.kind === "Text") {
      previous.value += node.value;
    } else {
      merged.push(node);
    }
  }
  return merged;
}

function plainInlineText(nodes: InlineNode[]): string {
  return nodes.map((node) => {
    if (node.kind === "Text" || node.kind === "InlineCode") return "value" in node ? node.value : "";
    if ("children" in node && Array.isArray(node.children)) return plainInlineText(node.children as InlineNode[]);
    if (node.kind === "MathInline") return node.content;
    if (node.kind === "Citation") return node.items.map((item) => item.key).join(" ");
    if (node.kind === "CrossRef") return node.id;
    if (node.kind === "FootnoteRef") return node.id;
    if (node.kind === "ImageInline") return node.alt;
    return "";
  }).join("");
}

function headingRole(level: HeadingNode["level"], attrs: Attributes): HeadingNode["canonicalRole"] {
  if (attrs.classes.includes("part")) return "part";
  if (attrs.classes.includes("chapter")) return "chapter";
  if (attrs.classes.includes("appendix")) return "appendix";
  return level === 1 ? "section" : undefined;
}

function mergeAttributes(primary: Attributes, secondary: Attributes): Attributes {
  return {
    id: primary.id ?? secondary.id,
    classes: [...new Set([...primary.classes, ...secondary.classes])],
    kv: { ...secondary.kv, ...primary.kv },
    aliases: [...secondary.aliases, ...primary.aliases],
    normalized: { ...secondary.normalized, ...primary.normalized }
  };
}

function isTableRow(text: string): boolean {
  return /^\s*\|.+\|\s*$/.test(text);
}

function splitTableRow(text: string): string[] {
  return text.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function splitTableAlignments(text: string): Array<"left" | "center" | "right"> {
  return splitTableRow(text).map((cell) => {
    const value = cell.trim();
    const left = value.startsWith(":");
    const right = value.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

function splitTrailingAttributes(text: string): { text: string; attrs?: string } {
  const attrMatch = text.match(/^(.*?)\s+(\{[^}]*\})\s*$/);
  return {
    text: (attrMatch?.[1] ?? text).trim(),
    attrs: attrMatch?.[2]
  };
}

function parseImageCommandArgs(rawArgs: string): { path: string; caption: string; attrs: Attributes } {
  const attrMatch = rawArgs.match(/^(.*?)\s*(\{[^}]*\})\s*$/);
  const args = (attrMatch?.[1] ?? rawArgs).trim();
  const attrs = parseAttributes(attrMatch?.[2]);
  const [rawPath, ...captionParts] = splitImageCommandParts(args);
  return {
    path: stripQuotes(rawPath.trim()),
    caption: captionParts.join(" | ").trim(),
    attrs
  };
}

function parseChartCommandArgs(rawArgs: string): { title: string; items: string[]; attrs: Attributes } {
  const attrMatch = rawArgs.match(/^(.*?)\s*(\{[^}]*\})\s*$/);
  const args = (attrMatch?.[1] ?? rawArgs).trim();
  const attrs = parseAttributes(attrMatch?.[2]);
  const [rawTitle, ...rawItems] = splitChartCommandParts(args);
  return {
    title: stripQuotes((rawTitle ?? "Grafico").trim()) || "Grafico",
    items: rawItems.map(normalizeChartItem).filter(Boolean),
    attrs
  };
}

function parseTitledItems(rawArgs: string): { title: string; items: string[] } {
  const [rawTitle, ...rawItems] = splitChartCommandParts(rawArgs);
  const title = stripQuotes((rawTitle ?? "Items").trim()) || "Items";
  return {
    title,
    items: rawItems.map(normalizeKeyValueItem).filter(Boolean)
  };
}

function parseEasyTableArgs(rawArgs: string): { title: string; headers: string[]; rows: string[][] } {
  const [rawTitle, rawHeaders, ...rawRows] = splitChartCommandParts(rawArgs);
  const title = stripQuotes((rawTitle ?? "Tabla").trim()) || "Tabla";
  const headers = splitSemicolonCells(rawHeaders ?? "");
  const rows = rawRows.map(splitSemicolonCells).filter((row) => row.length > 0);
  return {
    title,
    headers: headers.length > 0 ? headers : ["Campo", "Valor"],
    rows
  };
}

function parseShapeCommandArgs(rawArgs: string): { text: string; options: string[] } {
  const [rawText, ...options] = splitChartCommandParts(rawArgs);
  return {
    text: stripQuotes((rawText ?? "").trim()),
    options: options.flatMap((option) => option.split(/\s+/)).map((option) => option.trim()).filter(Boolean)
  };
}

function shapeAttributes(rawName: string, options: string[]): Attributes {
  const aliases: string[] = [rawName];
  const kv: Record<string, string> = {};
  for (const option of options) {
    const normalized = option.toLowerCase();
    const keyValue = normalized.match(/^([^=]+)=(.+)$/);
    if (keyValue) {
      const key = keyValue[1];
      const value = keyValue[2];
      if (key === "fondo" || key === "bg") aliases.push(`fondo-${value}`);
      else if (key === "tamano" || key === "tamaño" || key === "size") aliases.push(value);
      else kv[key] = value;
      continue;
    }
    aliases.push(option);
  }
  const attrs = attributesFromAliases(aliases);
  attrs.kv = { ...attrs.kv, ...kv };
  attrs.normalized = { ...attrs.normalized, ...kv };
  return attrs;
}

function splitImageCommandParts(args: string): string[] {
  if (args.startsWith('"') || args.startsWith("'")) {
    const quote = args[0];
    const end = args.indexOf(quote, 1);
    if (end > 0) {
      const pathValue = args.slice(0, end + 1);
      const rest = args.slice(end + 1).trim();
      if (rest.startsWith("|")) return [pathValue, rest.slice(1).trim()];
      return [pathValue];
    }
  }
  return args.split(/\s+\|\s+/);
}

function splitChartCommandParts(args: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (const char of args) {
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      current += char;
      continue;
    }
    if (char === quote) {
      quote = undefined;
      current += char;
      continue;
    }
    if (char === "|" && !quote) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function normalizeChartItem(item: string): string {
  return normalizeKeyValueItem(item);
}

function normalizeKeyValueItem(item: string): string {
  const trimmed = item.trim();
  const equals = trimmed.match(/^(.+?)\s*=\s*(.+)$/);
  if (equals) return `${equals[1].trim()}: ${equals[2].trim()}`;
  const colon = trimmed.match(/^(.+?)\s*:\s*(.+)$/);
  if (colon) return `${colon[1].trim()}: ${colon[2].trim()}`;
  return trimmed;
}

function normalizeCoordinateItem(item: string): string {
  const trimmed = item.trim();
  const spaced = trimmed.match(/^(\S+)\s+(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)(?:\s+.*)?$/);
  if (spaced) return `${spaced[1]}: ${spaced[2]}, ${spaced[3]}`;
  const semicolon = splitSemicolonCells(trimmed);
  if (semicolon.length >= 3) return `${semicolon[0]}: ${semicolon[1]}, ${semicolon[2]}`;
  const csv = trimmed.split(",").map((part) => part.trim()).filter(Boolean);
  if (csv.length >= 3) return `${csv[0]}: ${csv[1]}, ${csv[2]}`;
  const equals = trimmed.match(/^(.+?)\s*=\s*(.+)$/);
  if (equals) return `${equals[1].trim()}: ${equals[2].trim()}`;
  return normalizeKeyValueItem(trimmed);
}

function parseCoordinateConfigLine(text: string): { key: string; value: string } | undefined {
  const trimmed = text.trim();
  const normalized = slugify(trimmed);
  if (normalized === "cerrar" || normalized === "cerrado" || normalized === "closed") {
    return { key: "closed", value: "true" };
  }

  const match = trimmed.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ_-]+)\s*(?::|=)?\s+(.+)$/);
  if (!match) return undefined;
  const key = match[1].toLowerCase();
  const value = stripQuotes(match[2].trim());
  const aliases: Record<string, string> = {
    zona: "zone",
    zone: "zone",
    datum: "datum",
    srid: "srid",
    ubicacion: "location",
    ubicación: "location",
    location: "location",
    escala: "scale",
    scale: "scale",
    grilla: "grid",
    grid: "grid",
    fondo: "background",
    background: "background",
    foto: "background",
    imagen: "background",
    image: "background",
    opacidad: "opacity",
    opacity: "opacity",
    color: "color",
    relleno: "fill",
    fill: "fill",
    titulo: "title",
    title: "title"
  };
  const canonical = aliases[key];
  return canonical ? { key: canonical, value } : undefined;
}

function looksLikeCoordinateRow(text: string): boolean {
  const trimmed = text.trim();
  if (/^\S+\s+-?\d+(?:[.,]\d+)?\s+-?\d+(?:[.,]\d+)?(?:\s+.*)?$/.test(trimmed)) return true;
  if (splitSemicolonCells(trimmed).length >= 3) return true;
  if (trimmed.split(",").map((part) => part.trim()).filter(Boolean).length >= 3) return true;
  return /^.+?:\s*-?\d+(?:[.,]\d+)?\s*[,;]\s*-?\d+(?:[.,]\d+)?/.test(trimmed);
}

function splitSemicolonCells(row: string): string[] {
  return row.split(";").map((cell) => cell.trim()).filter(Boolean);
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function autoFigureId(imagePath: string): string {
  return `fig:${slugify(pathBasenameWithoutExtension(imagePath)) || "imagen"}`;
}

function defaultFigureCaption(imagePath: string): string {
  return pathBasenameWithoutExtension(imagePath)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Imagen";
}

function pathBasenameWithoutExtension(imagePath: string): string {
  const cleanPath = imagePath.split(/[?#]/)[0] ?? imagePath;
  const base = cleanPath.split(/[\\/]/).filter(Boolean).at(-1) ?? cleanPath;
  return base.replace(/\.[A-Za-z0-9]+$/, "");
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function startsBlock(text: string): boolean {
  return (
    startsComment(text) ||
    /^#{1,6}\s+/.test(text) ||
    /^:::\s*/.test(text) ||
    /^```/.test(text) ||
    /^\$\$/.test(text.trim()) ||
    /^:/.test(text) ||
    startsSimpleCommand(text) ||
    startsSimpleDirective(text) ||
    /^!\[/.test(text) ||
    /^>/.test(text) ||
    /^(\s*)([-*+]|\d+\.)\s+/.test(text) ||
    /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(text) ||
    isTableRow(text)
  );
}

function startsComment(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("%") || trimmed.startsWith("<!--");
}

function startsSimpleCommand(text: string): boolean {
  const match = text.trim().match(/^:?([A-Za-zÁÉÍÓÚÜÑáéíóúüñ_-]+)\s+.+$/);
  return Boolean(match && SIMPLE_COMMAND_NAMES.has(match[1].toLowerCase()));
}

function startsSimpleDirective(text: string): boolean {
  const match = text.trim().match(/^:?([A-Za-zÁÉÍÓÚÜÑáéíóúüñ_-]+)(?:\s+.*)?$/);
  return Boolean(match && directiveAliases[match[1].toLowerCase()]);
}

function position(line: ParserLine, file?: string): SourcePosition {
  return { file, line: line.number, column: 1, offset: line.offset };
}

function toLines(source: string, startLine = 1): ParserLine[] {
  const rawLines = source.replace(/\r\n/g, "\n").split("\n");
  let offset = 0;
  return rawLines.map((text, index) => {
    const line = { text, number: startLine + index, offset };
    offset += text.length + 1;
    return line;
  });
}

function countLines(source: string): number {
  if (!source) return 0;
  return source.replace(/\r\n/g, "\n").split("\n").length - 1;
}

function stripTrailingPunctuation(token: string): string {
  return token.replace(/[.,;:!?]+$/, "");
}
