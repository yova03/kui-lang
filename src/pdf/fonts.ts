import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CompileOptions } from "../core/project.js";
import type { NativePdfContext, FontRole, FontSet, FontFamilyDefinition } from "./types.js";
import { frontmatterText } from "./layout.js";

const BUILT_IN_FONTS: FontSet = {
  family: "PDF built-ins",
  body: "Helvetica",
  bold: "Helvetica-Bold",
  italic: "Helvetica-Oblique",
  boldItalic: "Helvetica-BoldOblique",
  serif: "Times-Roman",
  serifBold: "Times-Bold",
  serifItalic: "Times-Italic",
  mono: "Courier"
};

export const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");

const WINDOWS_FONT_DIR = path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts");

const MAC_SUPPLEMENTAL_FONT_DIR = "/System/Library/Fonts/Supplemental";

const DEFAULT_FONT_FAMILY_ID = "arial narrow";

const FONT_FAMILIES: Record<string, FontFamilyDefinition> = {
  "arial narrow": {
    family: "Arial Narrow",
    regular: firstExistingFontPath(
      path.join(WINDOWS_FONT_DIR, "ARIALN.TTF"),
      path.join(WINDOWS_FONT_DIR, "ArialN.ttf"),
      path.join(WINDOWS_FONT_DIR, "LiberationSansNarrow-Regular.ttf"),
      path.join(MAC_SUPPLEMENTAL_FONT_DIR, "Arial Narrow.ttf")
    ),
    bold: firstExistingFontPath(
      path.join(WINDOWS_FONT_DIR, "ARIALNB.TTF"),
      path.join(WINDOWS_FONT_DIR, "ArialNB.ttf"),
      path.join(WINDOWS_FONT_DIR, "LiberationSansNarrow-Bold.ttf"),
      path.join(MAC_SUPPLEMENTAL_FONT_DIR, "Arial Narrow Bold.ttf")
    ),
    italic: firstExistingFontPath(
      path.join(WINDOWS_FONT_DIR, "ARIALNI.TTF"),
      path.join(WINDOWS_FONT_DIR, "ArialNI.ttf"),
      path.join(WINDOWS_FONT_DIR, "LiberationSansNarrow-Italic.ttf"),
      path.join(MAC_SUPPLEMENTAL_FONT_DIR, "Arial Narrow Italic.ttf")
    ),
    boldItalic: firstExistingFontPath(
      path.join(WINDOWS_FONT_DIR, "ARIALNBI.TTF"),
      path.join(WINDOWS_FONT_DIR, "ArialNBI.ttf"),
      path.join(WINDOWS_FONT_DIR, "LiberationSansNarrow-BoldItalic.ttf"),
      path.join(MAC_SUPPLEMENTAL_FONT_DIR, "Arial Narrow Bold Italic.ttf")
    )
  },
  "liberation sans narrow": {
    family: "Liberation Sans Narrow",
    regular: path.join(WINDOWS_FONT_DIR, "LiberationSansNarrow-Regular.ttf"),
    bold: path.join(WINDOWS_FONT_DIR, "LiberationSansNarrow-Bold.ttf"),
    italic: path.join(WINDOWS_FONT_DIR, "LiberationSansNarrow-Italic.ttf"),
    boldItalic: path.join(WINDOWS_FONT_DIR, "LiberationSansNarrow-BoldItalic.ttf")
  },
  "narrow": {
    family: "Liberation Sans Narrow",
    regular: path.join(WINDOWS_FONT_DIR, "LiberationSansNarrow-Regular.ttf"),
    bold: path.join(WINDOWS_FONT_DIR, "LiberationSansNarrow-Bold.ttf"),
    italic: path.join(WINDOWS_FONT_DIR, "LiberationSansNarrow-Italic.ttf"),
    boldItalic: path.join(WINDOWS_FONT_DIR, "LiberationSansNarrow-BoldItalic.ttf")
  },
  "montserrat": {
    family: "Montserrat",
    regular: path.join(FONT_DIR, "montserrat/Montserrat-Regular.ttf"),
    bold: path.join(FONT_DIR, "montserrat/Montserrat-Bold.ttf"),
    italic: path.join(FONT_DIR, "montserrat/Montserrat-Italic.ttf"),
    boldItalic: path.join(FONT_DIR, "montserrat/Montserrat-BoldItalic.ttf")
  }
};

export const ICONS: Record<string, string> = {
  mail: "",
  phone: "",
  business: "",
  calendar: "",
  description: "",
  label: "",
  info: "",
  assignment: ""
};

export function registerDocumentFonts(
  doc: PDFKit.PDFDocument,
  data: Record<string, unknown> | undefined,
  options: CompileOptions,
  sourceFile?: string
): FontSet {
  const iconsPath = path.join(FONT_DIR, "material-icons/MaterialIcons-Regular.ttf");
  if (existsSync(iconsPath)) {
    doc.registerFont("KUI-Icons", iconsPath);
  }

  const customDefinition = customFontDefinition(data, options, sourceFile);
  if (customDefinition && existsSync(customDefinition.regular)) {
    return registerFontDefinition(doc, customDefinition);
  }

  const requested = requestedFontFamily(data);
  const normalizedRequested = requested ? normalizeFontFamilyName(requested) : "";

  const selectedFamily = normalizedRequested || DEFAULT_FONT_FAMILY_ID;
  const definition = FONT_FAMILIES[selectedFamily];

  if (!definition || !existsSync(definition.regular)) return BUILT_IN_FONTS;
  return registerFontDefinition(doc, definition);
}

function registerFontDefinition(doc: PDFKit.PDFDocument, definition: FontFamilyDefinition): FontSet {
  const prefix = `KUI-${definition.family.replace(/[^A-Za-z0-9]/g, "")}`;
  const register = (role: string, file: string | undefined): string => {
    const fontFile = file && existsSync(file) ? file : definition.regular;
    const alias = `${prefix}-${role}`;
    doc.registerFont(alias, fontFile);
    return alias;
  };

  const regular = register("Regular", definition.regular);
  const bold = register("Bold", definition.bold);
  const italic = register("Italic", definition.italic);
  const boldItalic = register("BoldItalic", definition.boldItalic ?? definition.bold ?? definition.italic);

  return {
    family: definition.family,
    body: regular,
    bold,
    italic,
    boldItalic,
    serif: regular,
    serifBold: bold,
    serifItalic: italic,
    mono: BUILT_IN_FONTS.mono
  };
}

function customFontDefinition(
  data: Record<string, unknown> | undefined,
  options: CompileOptions,
  sourceFile?: string
): FontFamilyDefinition | undefined {
  const fonts = data?.fonts;
  if (!fonts || typeof fonts !== "object" || Array.isArray(fonts)) return undefined;
  const record = fonts as Record<string, unknown>;
  const regular = frontmatterText(record.regular ?? record.body);
  if (!regular) return undefined;
  const family = frontmatterText(record.family ?? record.name) || requestedFontFamily(data) || "Custom";
  return {
    family,
    regular: resolveFontPath(regular, options, sourceFile),
    bold: optionalFontPath(record.bold, options, sourceFile),
    italic: optionalFontPath(record.italic, options, sourceFile),
    boldItalic: optionalFontPath(record.boldItalic ?? record.bold_italic, options, sourceFile)
  };
}

function optionalFontPath(value: unknown, options: CompileOptions, sourceFile?: string): string | undefined {
  const text = frontmatterText(value);
  return text ? resolveFontPath(text, options, sourceFile) : undefined;
}

function resolveFontPath(rawPath: string, options: CompileOptions, sourceFile?: string): string {
  if (path.isAbsolute(rawPath)) return rawPath;
  return path.resolve(sourceFile ? path.dirname(sourceFile) : options.cwd, rawPath);
}

function requestedFontFamily(data: Record<string, unknown> | undefined): string {
  if (!data) return "";
  const direct = frontmatterText(data.fontFamily ?? data.font ?? data.typography);
  if (direct) return direct;
  const fonts = data.fonts;
  if (fonts && typeof fonts === "object" && !Array.isArray(fonts)) {
    const record = fonts as Record<string, unknown>;
    return frontmatterText(record.family ?? record.body);
  }
  return "";
}

function normalizeFontFamilyName(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function firstExistingFontPath(...candidates: string[]): string {
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? "";
}

export function fontName(ctx: NativePdfContext, role: FontRole): string {
  return ctx.fonts[role] ?? BUILT_IN_FONTS[role];
}
