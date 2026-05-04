import type { DiagnosticBag } from "../core/diagnostics.js";

export const DEFAULT_TEMPLATE_ID = "paper-APA";

export interface TemplateManifest {
  id: string;
  name: string;
  documentClass: string;
  classOptions: string[];
  pdfEngine: "native" | "pdflatex" | "xelatex" | "lualatex";
  requiredFields: string[];
  supports: {
    bibliography: boolean;
    index: boolean;
    glossary: boolean;
    theorems: boolean;
    toc: boolean;
    lof: boolean;
    lot: boolean;
  };
  defaultStyle: {
    colors: Record<string, string>;
    fontSize: string;
    language: string;
    margins: { top: number; right: number; bottom: number; left: number };
  };
}

export const builtInTemplates: TemplateManifest[] = [
  {
    id: "paper-IEEE",
    name: "Paper IEEE",
    documentClass: "article",
    classOptions: ["conference", "10pt"],
    pdfEngine: "native",
    requiredFields: ["title", "author"],
    supports: {
      bibliography: true,
      index: false,
      glossary: false,
      theorems: true,
      toc: true,
      lof: true,
      lot: true
    },
    defaultStyle: {
      colors: { primary: "#1A5490", secondary: "#E63946", accent: "#F4A261", text: "#222222", muted: "#666666" },
      fontSize: "10pt",
      language: "en",
      margins: { top: 54, right: 54, bottom: 60, left: 54 }
    }
  },
  {
    id: "paper-APA",
    name: "Paper APA 7",
    documentClass: "article",
    classOptions: ["12pt"],
    pdfEngine: "native",
    requiredFields: ["title", "author"],
    supports: {
      bibliography: true,
      index: true,
      glossary: true,
      theorems: true,
      toc: true,
      lof: true,
      lot: true
    },
    defaultStyle: {
      colors: { primary: "#215A36", secondary: "#8E3B46", accent: "#C99700", text: "#222222", muted: "#666666" },
      fontSize: "12pt",
      language: "es",
      margins: { top: 72, right: 72, bottom: 72, left: 72 }
    }
  },
  {
    id: "tesis-unsaac",
    name: "Tesis pregrado UNSAAC",
    documentClass: "report",
    classOptions: ["12pt"],
    pdfEngine: "native",
    requiredFields: ["title", "author", "asesor", "institucion", "facultad", "school", "academicDegree"],
    supports: {
      bibliography: true,
      index: true,
      glossary: true,
      theorems: true,
      toc: true,
      lof: true,
      lot: true
    },
    defaultStyle: {
      colors: { primary: "#111111", secondary: "#111111", accent: "#111111", text: "#111111", muted: "#444444" },
      fontSize: "12pt",
      language: "es",
      margins: { top: 72, right: 72, bottom: 72, left: 72 }
    }
  },
  {
    id: "informe-operativo",
    name: "Informe operativo",
    documentClass: "report",
    classOptions: ["10pt"],
    pdfEngine: "native",
    requiredFields: ["title", "author", "subtitle", "organization", "period"],
    supports: {
      bibliography: false,
      index: false,
      glossary: false,
      theorems: false,
      toc: true,
      lof: false,
      lot: true
    },
    defaultStyle: {
      colors: { primary: "#1D2A44", secondary: "#C05A2B", accent: "#E88B55", text: "#111827", muted: "#667085" },
      fontSize: "10pt",
      language: "es",
      margins: { top: 82, right: 50, bottom: 70, left: 50 }
    }
  },
  {
    id: "brochure-visual",
    name: "Brochure visual",
    documentClass: "brochure",
    classOptions: ["10pt"],
    pdfEngine: "native",
    requiredFields: ["title", "author", "subtitle"],
    supports: {
      bibliography: false,
      index: false,
      glossary: false,
      theorems: false,
      toc: false,
      lof: false,
      lot: false
    },
    defaultStyle: {
      colors: { primary: "#111827", secondary: "#7C3AED", accent: "#22D3EE", text: "#111827", muted: "#64748B" },
      fontSize: "10pt",
      language: "es",
      margins: { top: 46, right: 42, bottom: 50, left: 42 }
    }
  },
  {
    id: "plano-tecnico",
    name: "Plano tecnico",
    documentClass: "plan-sheet",
    classOptions: ["10pt"],
    pdfEngine: "native",
    requiredFields: ["title", "author"],
    supports: {
      bibliography: false,
      index: false,
      glossary: false,
      theorems: false,
      toc: false,
      lof: false,
      lot: true
    },
    defaultStyle: {
      colors: { primary: "#111827", secondary: "#8E3B46", accent: "#2563EB", text: "#111827", muted: "#64748B" },
      fontSize: "10pt",
      language: "es",
      margins: { top: 28, right: 28, bottom: 28, left: 28 }
    }
  },
  {
    id: "article-digital-economy",
    name: "Digital economy academic article",
    documentClass: "article",
    classOptions: ["10pt"],
    pdfEngine: "native",
    requiredFields: ["title", "author", "subtitle"],
    supports: {
      bibliography: true,
      index: false,
      glossary: false,
      theorems: false,
      toc: false,
      lof: false,
      lot: true
    },
    defaultStyle: {
      colors: { primary: "#111111", secondary: "#111111", accent: "#111111", text: "#111111", muted: "#444444" },
      fontSize: "10pt",
      language: "en",
      margins: { top: 58, right: 58, bottom: 58, left: 58 }
    }
  }
];

export function findTemplate(id: unknown): TemplateManifest | undefined {
  const templateId = typeof id === "string" && id.trim() ? id.trim() : DEFAULT_TEMPLATE_ID;
  return builtInTemplates.find((candidate) => candidate.id === templateId);
}

export function resolveTemplate(id: unknown, diagnostics?: DiagnosticBag): TemplateManifest {
  const templateId = typeof id === "string" && id.trim() ? id.trim() : DEFAULT_TEMPLATE_ID;
  const template = builtInTemplates.find((candidate) => candidate.id === templateId);
  if (!template) {
    diagnostics?.warning(
      "KUI-W060",
      `La plantilla "${templateId}" no está instalada. Se usará ${DEFAULT_TEMPLATE_ID}.`
    );
    return defaultTemplate();
  }
  return template;
}

export function listTemplates(): TemplateManifest[] {
  return builtInTemplates;
}

function defaultTemplate(): TemplateManifest {
  return builtInTemplates.find((candidate) => candidate.id === DEFAULT_TEMPLATE_ID) ?? builtInTemplates[0];
}
