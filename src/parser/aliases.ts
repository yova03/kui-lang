import { emptyAttributes, type Attributes } from "../core/ast.js";

const colorAliases: Record<string, string> = {
  rojo: "red",
  red: "red",
  azul: "blue",
  blue: "blue",
  verde: "green",
  green: "green",
  amarillo: "yellow",
  yellow: "yellow",
  gris: "gray",
  gray: "gray",
  negro: "black",
  black: "black",
  blanco: "white",
  white: "white",
  naranja: "orange",
  orange: "orange",
  morado: "purple",
  purple: "purple",
  rosa: "pink",
  pink: "pink",
  primary: "primary",
  secondary: "secondary",
  accent: "accent",
  muted: "muted"
};

const backgroundPrefixes = ["bg-", "fondo-"];

const sizeAliases: Record<string, string> = {
  xs: "xs",
  sm: "sm",
  md: "md",
  lg: "lg",
  xl: "xl",
  "2xl": "2xl",
  "3xl": "3xl",
  pequeño: "small",
  pequena: "small",
  small: "small",
  mediano: "medium",
  medium: "medium",
  grande: "large",
  big: "large",
  large: "large",
  enorme: "huge",
  huge: "huge",
  gigante: "Huge"
};

const weightAliases: Record<string, string> = {
  negrita: "bold",
  bold: "bold",
  medio: "medium",
  medium: "medium",
  delgado: "light",
  light: "light"
};

const styleAliases: Record<string, string> = {
  cursiva: "italic",
  italic: "italic",
  inclinada: "slanted",
  slanted: "slanted",
  smallcaps: "smallcaps"
};

const alignAliases: Record<string, string> = {
  centro: "center",
  center: "center",
  izquierda: "left",
  left: "left",
  derecha: "right",
  right: "right",
  justificar: "justify",
  justify: "justify"
};

const classAliases: Record<string, string> = {
  caja: "box",
  box: "box",
  borde: "border",
  border: "border",
  marco: "border",
  sombra: "shadow",
  shadow: "shadow",
  redondo: "round",
  round: "round"
};

export const directiveAliases: Record<string, string> = {
  indice: "toc",
  toc: "toc",
  figuras: "lof",
  lof: "lof",
  tablas: "lot",
  lot: "lot",
  glosario: "glossary",
  glossary: "glossary",
  bibliografia: "bibliography",
  bibliography: "bibliography",
  apendice: "appendix",
  appendix: "appendix",
  incluir: "include",
  include: "include",
  paginacion: "pagenumbering",
  "paginación": "pagenumbering",
  numeracion: "pagenumbering",
  "numeración": "pagenumbering",
  pagenumbering: "pagenumbering",
  nuevapagina: "newpage",
  newpage: "newpage",
  clearpage: "clearpage",
  limpiarpagina: "clearpage",
  vspace: "vspace"
};

export const fencedDivAliases: Record<string, string> = {
  presentacion: "presentacion",
  "presentación": "presentacion",
  dedicatoria: "dedicatoria",
  agradecimiento: "agradecimiento",
  introduccion: "introduccion",
  "introducción": "introduccion",
  discusiones: "discusiones",
  conclusiones: "conclusiones",
  recomendaciones: "recomendaciones",
  resumen: "abstract",
  abstract: "abstract",
  abs: "abstract",
  teorema: "theorem",
  theorem: "theorem",
  definicion: "definition",
  definición: "definition",
  definition: "definition",
  prueba: "proof",
  demostracion: "proof",
  demostración: "proof",
  proof: "proof",
  lema: "lemma",
  lemma: "lemma",
  corolario: "corollary",
  corollary: "corollary",
  centro: "center",
  center: "center",
  izquierda: "left",
  left: "left",
  derecha: "right",
  right: "right",
  caja: "box",
  box: "box",
  cuadrado: "shape",
  square: "shape",
  circulo: "shape",
  círculo: "shape",
  circle: "shape",
  triangulo: "shape",
  triángulo: "shape",
  triangle: "shape",
  nota: "note",
  note: "note",
  aviso: "warning",
  warning: "warning",
  pendiente: "todo",
  todo: "todo",
  "resumen-operativo": "executive-summary",
  resumenoperativo: "executive-summary",
  "executive-summary": "executive-summary",
  "kpi-grid": "kpi-grid",
  kpis: "kpi-grid",
  indicadores: "kpi-grid",
  grafico: "bar-chart",
  gráfico: "bar-chart",
  graficos: "bar-chart",
  gráficos: "bar-chart",
  barras: "bar-chart",
  "grafico-barras": "bar-chart",
  "gráfico-barras": "bar-chart",
  chart: "bar-chart",
  "bar-chart": "bar-chart",
  "matriz-riesgo": "risk-matrix",
  "matriz-riesgos": "risk-matrix",
  "risk-matrix": "risk-matrix",
  "semaforo": "status-grid",
  "semáforo": "status-grid",
  "status-grid": "status-grid",
  cronograma: "timeline",
  timeline: "timeline",
  firma: "signature",
  firmas: "signature",
  signature: "signature",
  brochure: "brochure-hero",
  "brochure-hero": "brochure-hero",
  "hero-brochure": "brochure-hero",
  "portada-brochure": "brochure-hero",
  "gradient-panel": "gradient-panel",
  "panel-gradient": "gradient-panel",
  "franja-gradient": "gradient-panel",
  "franja-difuminada": "gradient-panel",
  difuminado: "gradient-panel",
  plano: "coordinate-plane",
  "plano-cartesiano": "coordinate-plane",
  "plano-coordenadas": "coordinate-plane",
  coordenadas: "coordinate-plane",
  poligono: "coordinate-plane",
  "polígono": "coordinate-plane",
  "coordinate-plane": "coordinate-plane"
};

const shapeTypes: Record<string, string> = {
  cuadrado: "square",
  square: "square",
  circulo: "circle",
  círculo: "circle",
  circle: "circle",
  triangulo: "triangle",
  triángulo: "triangle",
  triangle: "triangle"
};

export function parseAttributes(raw?: string): Attributes {
  const attrs = emptyAttributes();
  if (!raw) return attrs;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return attrs;
  const body = trimmed.slice(1, -1).trim();
  if (!body) return attrs;

  for (const token of tokenizeAttributes(body)) {
    if (token.startsWith("#")) {
      attrs.id = token.slice(1);
      continue;
    }
    if (token.startsWith(".")) {
      attrs.classes.push(token.slice(1));
      continue;
    }
    const eqIndex = token.indexOf("=");
    if (eqIndex > 0) {
      const key = token.slice(0, eqIndex);
      const value = unquote(token.slice(eqIndex + 1));
      attrs.kv[key] = value;
      continue;
    }
    attrs.aliases.push(token);
  }

  return normalizeAttributes(attrs);
}

export function attributesFromAliases(aliases: string[]): Attributes {
  const attrs = emptyAttributes();
  attrs.aliases.push(...aliases);
  return normalizeAttributes(attrs);
}

export function normalizeAttributes(attrs: Attributes): Attributes {
  attrs.normalized = { ...attrs.kv };

  for (const alias of attrs.aliases) {
    const normalizedAlias = alias.toLowerCase();
    const bgPrefix = backgroundPrefixes.find((prefix) => normalizedAlias.startsWith(prefix));
    if (bgPrefix) {
      const colorKey = normalizedAlias.slice(bgPrefix.length);
      attrs.normalized.bg = colorAliases[colorKey] ?? colorKey;
      continue;
    }
    if (normalizedAlias === "marca") {
      attrs.normalized.bg = "yellow";
      continue;
    }
    if (colorAliases[normalizedAlias]) {
      attrs.normalized.color = colorAliases[normalizedAlias];
      continue;
    }
    if (sizeAliases[normalizedAlias]) {
      attrs.normalized.size = sizeAliases[normalizedAlias];
      continue;
    }
    if (weightAliases[normalizedAlias]) {
      attrs.normalized.weight = weightAliases[normalizedAlias];
      continue;
    }
    if (styleAliases[normalizedAlias]) {
      attrs.normalized.style = styleAliases[normalizedAlias];
      continue;
    }
    if (alignAliases[normalizedAlias]) {
      attrs.normalized.align = alignAliases[normalizedAlias];
      continue;
    }
    if (classAliases[normalizedAlias]) {
      attrs.classes.push(classAliases[normalizedAlias]);
      continue;
    }
    if (shapeTypes[normalizedAlias]) {
      attrs.normalized.type = shapeTypes[normalizedAlias];
      continue;
    }
  }

  for (const [key, value] of Object.entries(attrs.kv)) {
    attrs.normalized[key] = value;
  }

  attrs.classes = [...new Set(attrs.classes)];
  return attrs;
}

function tokenizeAttributes(body: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | undefined;

  for (const char of body) {
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
    if (/\s/.test(char) && !quote) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
