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
}

export interface ParseOptions {
  file?: string;
}

export function parseKui(source: string, options: ParseOptions = {}): DocumentNode {
  const frontmatter = readFrontmatter(source, options.file);
  const diagnostics = new DiagnosticBag();
  diagnostics.merge(frontmatter.diagnostics);

  const bodyStartLine = countLines(source.slice(0, source.length - frontmatter.body.length)) + 1;
  const lines = toLines(frontmatter.body, bodyStartLine);
  const ctx: ParseContext = { file: options.file, diagnostics };
  const parser = new BlockParser(lines, ctx);
  const children = parser.parseBlocks();
  const document: DocumentNode = {
    kind: "Document",
    frontmatter: frontmatter.frontmatter,
    children,
    diagnostics: diagnostics.diagnostics,
    symbols: createEmptySymbols(),
    sourceFiles: options.file ? [options.file] : []
  };
  collectSymbols(document);
  return document;
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

      const parsed =
        this.parseHorizontalRule() ??
        this.parseCodeBlock() ??
        this.parseMathBlock() ??
        this.parseFencedDiv() ??
        this.parseImageCommand() ??
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
    const match = line.text.match(/^:([A-Za-zÁÉÍÓÚÜÑáéíóúüñ_-]+)(?:\s+(.*))?\s*$/);
    if (!match) return undefined;
    const rawName = match[1];
    const canonical = directiveAliases[rawName.toLowerCase()] ?? "unknown";
    if (canonical === "unknown") {
      this.ctx.diagnostics.error("KUI-E003", `Directiva desconocida :${rawName}.`, position(line, this.ctx.file));
    }
    this.index++;
    return {
      kind: "Directive",
      rawName,
      name: canonical as never,
      args: match[2] ?? "",
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
    const node: HeadingNode = {
      kind: "Heading",
      level,
      title: parseInline(match[2].replace(/\s+\{.*\}\s*$/, ""), position(line, this.ctx.file), this.ctx.diagnostics),
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
    const figure: FigureNode = {
      kind: "Figure",
      alt,
      caption: parseInline(alt, position(line, this.ctx.file), this.ctx.diagnostics),
      path: match[2],
      attrs: parseAttributes(match[3]),
      position: position(line, this.ctx.file)
    };
    return figure;
  }

  private parseImageCommand(): BlockNode | undefined {
    const line = this.current();
    if (!line) return undefined;
    const match = line.text.match(/^:(img|image|imagen|figura|figure)\s+(.+?)\s*$/i);
    if (!match) return undefined;

    const parsed = parseImageCommandArgs(match[2]);
    this.index++;
    if (!parsed.path) {
      this.ctx.diagnostics.error("KUI-E014", "La directiva de imagen requiere una ruta.", position(line, this.ctx.file));
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
    attrs.id ??= autoFigureId(parsed.path);
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

  private parseTable(): BlockNode | undefined {
    const start = this.current();
    if (!start || !isTableRow(start.text)) return undefined;
    const next = this.lines[this.index + 1];
    if (!next || !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next.text)) return undefined;

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
      const captionMatch = maybeCaption.text.match(/^:\s*(.*?)\s*(\{.*\})?\s*$/);
      if (captionMatch) {
        caption = parseInline(captionMatch[1], position(maybeCaption, this.ctx.file), this.ctx.diagnostics);
        attrs = parseAttributes(captionMatch[2]);
        this.index++;
      }
    }

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
    /^#{1,6}\s+/.test(text) ||
    /^:::\s*/.test(text) ||
    /^```/.test(text) ||
    /^\$\$/.test(text.trim()) ||
    /^:/.test(text) ||
    /^!\[/.test(text) ||
    /^>/.test(text) ||
    /^(\s*)([-*+]|\d+\.)\s+/.test(text) ||
    /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(text) ||
    isTableRow(text)
  );
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
