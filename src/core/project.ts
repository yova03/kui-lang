import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface KuiProjectConfig {
  main?: string;
  template?: string;
  buildDir?: string;
  language?: string;
}

export interface CompileOptions {
  cwd: string;
  outputDir: string;
  target?: "tex" | "pdf";
  strict?: boolean;
  pdfEngine?: "pdflatex" | "xelatex" | "lualatex";
}

export interface BuildArtifact {
  texPath: string;
  pdfPath?: string;
  auxFiles: string[];
}

export function readKuiProjectConfig(cwd = process.cwd()): KuiProjectConfig {
  const configPath = path.resolve(cwd, "kui.toml");
  if (!existsSync(configPath)) return {};

  const config: KuiProjectConfig = {};
  for (const rawLine of readFileSync(configPath, "utf8").split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;

    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(.+)$/);
    if (!match) continue;

    const key = normalizeConfigKey(match[1]);
    const value = parseTomlString(match[2].trim());
    if (value === undefined) continue;

    if (key === "main" || key === "template" || key === "buildDir" || key === "language") {
      config[key] = value;
    }
  }

  return config;
}

export function resolveKuiMainFile(cwd = process.cwd(), file?: string): string {
  if (file && file.trim() !== "") return file;
  return readKuiProjectConfig(cwd).main ?? "main.kui";
}

export function resolveKuiOutputDir(cwd = process.cwd(), outputDir?: string): string {
  if (outputDir && outputDir.trim() !== "") return outputDir;
  return readKuiProjectConfig(cwd).buildDir ?? "build";
}

export function applyProjectConfigDefaults(frontmatter: Record<string, unknown>, config: KuiProjectConfig): void {
  if (config.template && frontmatter.template === undefined) frontmatter.template = config.template;
  if (config.language && frontmatter.language === undefined) frontmatter.language = config.language;
}

function normalizeConfigKey(key: string): keyof KuiProjectConfig | string {
  if (key === "build-dir" || key === "build_dir" || key === "outDir" || key === "outputDir") return "buildDir";
  return key;
}

function parseTomlString(value: string): string | undefined {
  const quoted = value.match(/^(['"])(.*)\1$/);
  if (quoted) return quoted[2];

  const bare = value.match(/^[A-Za-z0-9._/ -]+$/);
  return bare ? value.trim() : undefined;
}

function stripTomlComment(line: string): string {
  let quote: string | undefined;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if ((char === "\"" || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? undefined : quote ?? char;
    }
    if (char === "#" && !quote) return line.slice(0, index);
  }
  return line;
}
