import type { Diagnostic, SourcePosition } from "./diagnostics.js";

export interface Attributes {
  id?: string;
  classes: string[];
  kv: Record<string, string>;
  aliases: string[];
  normalized: Record<string, string>;
}

export interface BaseNode {
  kind: string;
  position?: SourcePosition;
  attrs?: Attributes;
}

export interface DocumentNode extends BaseNode {
  kind: "Document";
  frontmatter?: FrontmatterNode;
  children: BlockNode[];
  diagnostics: Diagnostic[];
  symbols: SymbolTable;
  sourceFiles: string[];
}

export interface FrontmatterNode extends BaseNode {
  kind: "Frontmatter";
  raw: string;
  data: Record<string, unknown>;
}

export interface SymbolTable {
  labels: Record<string, SourcePosition | undefined>;
  citations: Record<string, SourcePosition | undefined>;
  bibliographyKeys: Set<string>;
  assets: Record<string, SourcePosition | undefined>;
}

export type BlockNode =
  | HeadingNode
  | ParagraphNode
  | ListNode
  | BlockquoteNode
  | CalloutNode
  | CodeBlockNode
  | MathBlockNode
  | FigureNode
  | TableNode
  | FencedDivNode
  | DirectiveNode
  | FootnoteDefNode
  | HorizontalRuleNode;

export type InlineNode =
  | TextNode
  | BoldNode
  | ItalicNode
  | InlineCodeNode
  | LinkNode
  | ImageInlineNode
  | SpanNode
  | MathInlineNode
  | CitationNode
  | CrossRefNode
  | FootnoteRefNode;

export interface HeadingNode extends BaseNode {
  kind: "Heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  title: InlineNode[];
  canonicalRole?: "part" | "chapter" | "section" | "appendix";
}

export interface ParagraphNode extends BaseNode {
  kind: "Paragraph";
  children: InlineNode[];
}

export interface ListNode extends BaseNode {
  kind: "List";
  ordered: boolean;
  task: boolean;
  items: ListItemNode[];
}

export interface ListItemNode extends BaseNode {
  kind: "ListItem";
  checked?: boolean;
  children: InlineNode[];
}

export interface BlockquoteNode extends BaseNode {
  kind: "Blockquote";
  children: BlockNode[];
}

export interface CalloutNode extends BaseNode {
  kind: "Callout";
  calloutType: "NOTE" | "TIP" | "WARNING" | "IMPORTANT" | "CAUTION" | "TODO" | "MARGIN" | "COMMENT";
  children: BlockNode[];
}

export interface CodeBlockNode extends BaseNode {
  kind: "CodeBlock";
  language?: string;
  content: string;
}

export interface MathBlockNode extends BaseNode {
  kind: "MathBlock";
  content: string;
}

export interface FigureNode extends BaseNode {
  kind: "Figure";
  path: string;
  caption: InlineNode[];
  alt: string;
}

export interface TableNode extends BaseNode {
  kind: "Table";
  headers: InlineNode[][];
  rows: InlineNode[][][];
  caption?: InlineNode[];
  alignments?: Array<"left" | "center" | "right">;
}

export interface FencedDivNode extends BaseNode {
  kind: "FencedDiv";
  name: string;
  canonicalName?: string;
  children: BlockNode[];
}

export type DirectiveName =
  | "toc"
  | "lof"
  | "lot"
  | "index"
  | "glossary"
  | "bibliography"
  | "appendix"
  | "newpage"
  | "clearpage"
  | "pagenumbering"
  | "include"
  | "vspace"
  | "unknown";

export interface DirectiveNode extends BaseNode {
  kind: "Directive";
  name: DirectiveName;
  rawName: string;
  args: string;
}

export interface FootnoteDefNode extends BaseNode {
  kind: "FootnoteDef";
  id: string;
  children: InlineNode[];
}

export interface HorizontalRuleNode extends BaseNode {
  kind: "HorizontalRule";
}

export interface TextNode extends BaseNode {
  kind: "Text";
  value: string;
}

export interface BoldNode extends BaseNode {
  kind: "Bold";
  children: InlineNode[];
}

export interface ItalicNode extends BaseNode {
  kind: "Italic";
  children: InlineNode[];
}

export interface InlineCodeNode extends BaseNode {
  kind: "InlineCode";
  value: string;
}

export interface LinkNode extends BaseNode {
  kind: "Link";
  url: string;
  children: InlineNode[];
}

export interface ImageInlineNode extends BaseNode {
  kind: "ImageInline";
  url: string;
  alt: string;
}

export interface SpanNode extends BaseNode {
  kind: "Span";
  children: InlineNode[];
}

export interface MathInlineNode extends BaseNode {
  kind: "MathInline";
  content: string;
}

export interface CitationNode extends BaseNode {
  kind: "Citation";
  items: Array<{ key: string; locator?: string }>;
  citationStyle: "parenthetical" | "intext";
}

export interface CrossRefNode extends BaseNode {
  kind: "CrossRef";
  refType: "fig" | "tbl" | "eq" | "sec" | "def" | "thm";
  id: string;
}

export interface FootnoteRefNode extends BaseNode {
  kind: "FootnoteRef";
  id: string;
}

export function emptyAttributes(): Attributes {
  return { classes: [], kv: {}, aliases: [], normalized: {} };
}

export function createEmptySymbols(): SymbolTable {
  return { labels: {}, citations: {}, bibliographyKeys: new Set(), assets: {} };
}
