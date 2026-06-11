import type { CrossRefNode, DocumentNode } from "../core/ast.js";
import type { Diagnostic } from "../core/diagnostics.js";
import type { CompileOptions } from "../core/project.js";
import { type CitationStyle, type KuiReferenceEntry } from "../semantic/bibliography.js";
import { type TemplateManifest } from "../templates/registry.js";

export interface NativePdfOutput {
  pdfPath: string;
  pdfBytes: Uint8Array;
  diagnostics: Diagnostic[];
  sourceFiles: string[];
  pageMap: NativePdfPageMap;
}

export interface NativePdfPageMap {
  headings: HeadingInfo[];
  labels: Record<string, LabelInfo>;
  footnotes: Array<{ id: string; number: number; page: number }>;
}

export interface LabelInfo {
  type: CrossRefNode["refType"];
  number: string;
  title?: string;
  page?: number;
}

export interface HeadingInfo {
  level: number;
  title: string;
  id?: string;
  page?: number;
}

interface TocPlaceholder {
  headingIndex: number;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  fontSize?: number;
  linkX: number;
  linkY: number;
  linkWidth: number;
  linkHeight: number;
  destination: string;
}

interface ListPlaceholder {
  labelId: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  fontSize?: number;
  linkX: number;
  linkY: number;
  linkWidth: number;
  linkHeight: number;
  destination: string;
}

export interface IndexEntryRow {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  linkX: number;
  linkY: number;
  linkWidth: number;
  linkHeight: number;
}

export interface ListedNodeInfo {
  labelId: string;
  title: string;
}

interface PageNumberingSegment {
  pageIndex: number;
  style: "arabic" | "roman";
}

export interface PageFootnote {
  id: string;
  number: number;
  text: string;
}

export interface NativePdfContext {
  doc: PDFKit.PDFDocument;
  document: DocumentNode;
  options: CompileOptions;
  template: TemplateManifest;
  fonts: FontSet;
  diagnostics: Diagnostic[];
  labels: Map<string, LabelInfo>;
  headingCounters: number[];
  figureCount: number;
  tableCount: number;
  equationCount: number;
  headings: HeadingInfo[];
  headingRenderIndex: number;
  tocPlaceholders: TocPlaceholder[];
  listPlaceholders: ListPlaceholder[];
  pageNumberingSegments: PageNumberingSegment[];
  footnotes: Map<string, string>;
  footnoteNumbers: Map<string, number>;
  footnotePages: Map<string, number>;
  pageFootnotes: Map<number, PageFootnote[]>;
  pageFootnoteReserves: Map<number, number>;
  currentInlineFootnotes: string[];
  registeredDestinations: Set<string>;
  references: Map<string, KuiReferenceEntry>;
  citationStyle: CitationStyle;
  citationNumbers: Map<string, number>;
}

export interface TableStyle {
  borderColor: string;
  headerFill: string;
  zebraFill: string;
  ruleMode: "grid" | "booktabs";
  fontSize: number;
  headerFontSize: number;
  paddingX: number;
  paddingY: number;
  lineGap: number;
  minRowHeight: number;
}

export interface TableCellLayout {
  text: string;
  lines: string[];
  align: "left" | "center" | "right";
}

export interface TableRowLayout {
  cells: TableCellLayout[];
  height: number;
  lineCount: number;
  header: boolean;
}

export type FontRole = "body" | "bold" | "italic" | "boldItalic" | "serif" | "serifBold" | "serifItalic" | "mono";

export interface FontSet extends Record<FontRole, string> {
  family: string;
}

export interface FontFamilyDefinition {
  family: string;
  regular: string;
  bold?: string;
  italic?: string;
  boldItalic?: string;
}

export interface SemanticItem {
  label: string;
  value: string;
  detail?: string;
}

export interface CoordinatePoint {
  label: string;
  x: number;
  y: number;
}

export interface InlineSegment {
  text: string;
  role: FontRole;
  color: string;
}

export interface InlineStyle {
  role: FontRole;
  color: string;
}
