import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export function readBibKeys(filePath: string): Set<string> {
  return readReferenceKeys(filePath);
}

export type ReferenceFormat = "bib" | "kref";

export interface ReferenceSource {
  path: string;
  format: ReferenceFormat;
}

export interface KuiReferenceEntry {
  key: string;
  type?: string;
  title?: string;
  author: string[];
  year?: string;
  journal?: string;
  publisher?: string;
  booktitle?: string;
  school?: string;
  institution?: string;
  howpublished?: string;
  note?: string;
  doi?: string;
  url?: string;
}

export function normalizeReferenceSources(data: Record<string, unknown> | undefined): ReferenceSource[] {
  const sources: ReferenceSource[] = [];
  for (const file of normalizeStringList(data?.bib)) {
    sources.push({ path: file, format: referenceFormatForPath(file) });
  }
  for (const file of normalizeStringList(data?.refs ?? data?.references ?? data?.kref ?? data?.krefs)) {
    sources.push({ path: file, format: "kref" });
  }

  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.format}:${source.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function readReferenceKeys(filePath: string): Set<string> {
  return new Set(readReferenceEntries(filePath).map((entry) => entry.key));
}

export function readReferenceEntries(filePath: string): KuiReferenceEntry[] {
  let content = "";
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  return parseReferenceContent(content, referenceFormatForPath(filePath));
}

export function parseReferenceContent(content: string, format: ReferenceFormat): KuiReferenceEntry[] {
  return format === "kref" ? parseKrefEntries(content) : parseBibEntries(content);
}

export function formatReferenceEntry(entry: KuiReferenceEntry): string {
  const author = entry.author.length > 0 ? formatReferenceAuthors(entry.author) : entry.key;
  const year = entry.year ? ` (${entry.year}).` : ".";
  const title = entry.title ? ` ${entry.title}.` : "";
  const container = entry.journal ?? entry.booktitle ?? entry.publisher ?? entry.school ?? entry.institution ?? entry.howpublished ?? entry.note ?? "";
  const doi = entry.doi ? ` DOI: ${entry.doi}.` : "";
  const url = entry.url ? ` ${entry.url}` : "";
  return `${author}${year}${title}${container ? ` ${container}.` : ""}${doi}${url}`.trim();
}

function referenceFormatForPath(filePath: string): ReferenceFormat {
  const extension = path.extname(filePath).toLowerCase();
  return extension === ".kref" || extension === ".kuiref" ? "kref" : "bib";
}

function parseKrefEntries(content: string): KuiReferenceEntry[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) => {
      if (!isRecord(item)) return [];
      const key = stringValue(item.key ?? item.id);
      return key ? [entryFromRecord(key, item)] : [];
    });
  }
  if (!isRecord(parsed)) return [];
  return Object.entries(parsed).flatMap(([key, value]) => {
    if (isRecord(value)) return [entryFromRecord(key, value)];
    const title = stringValue(value);
    return title ? [{ key, title, author: [] }] : [];
  });
}

function parseBibEntries(content: string): KuiReferenceEntry[] {
  const keys = new Set<string>();
  const entries: KuiReferenceEntry[] = [];
  const entryPattern = /@(\w+)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = entryPattern.exec(content))) {
    const bodyStart = entryPattern.lastIndex;
    const bodyEnd = findBalancedBraceEnd(content, bodyStart - 1);
    if (bodyEnd < 0) break;
    entryPattern.lastIndex = bodyEnd + 1;

    const body = content.slice(bodyStart, bodyEnd);
    const commaIndex = body.indexOf(",");
    if (commaIndex < 0) continue;

    const key = body.slice(0, commaIndex).trim();
    if (keys.has(key)) continue;
    keys.add(key);
    const fields = parseBibFields(body.slice(commaIndex + 1));
    entries.push({
      key,
      type: match[1],
      title: fields.title,
      author: normalizeAuthors(fields.author),
      year: fields.year,
      journal: fields.journal,
      publisher: fields.publisher,
      booktitle: fields.booktitle,
      school: fields.school,
      institution: fields.institution,
      howpublished: fields.howpublished,
      note: fields.note,
      doi: fields.doi,
      url: fields.url
    });
  }
  return entries;
}

function parseBibFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let index = 0;
  while (index < body.length) {
    while (index < body.length && /[\s,]/.test(body[index] ?? "")) index++;
    const name = /^(\w+)/.exec(body.slice(index));
    if (!name) {
      index++;
      continue;
    }
    index += name[0].length;
    while (index < body.length && /\s/.test(body[index] ?? "")) index++;
    if (body[index] !== "=") {
      index++;
      continue;
    }
    index++;
    while (index < body.length && /\s/.test(body[index] ?? "")) index++;
    const value = readBibFieldValue(body, index);
    if (!value) continue;
    fields[name[1].toLowerCase()] = cleanReferenceValue(value.value);
    index = value.end;
  }
  return fields;
}

function entryFromRecord(key: string, record: Record<string, unknown>): KuiReferenceEntry {
  return {
    key,
    type: stringValue(record.type),
    title: stringValue(record.title),
    author: normalizeAuthors(record.author ?? record.authors),
    year: stringValue(record.year ?? record.date),
    journal: stringValue(record.journal),
    publisher: stringValue(record.publisher),
    booktitle: stringValue(record.booktitle ?? record.bookTitle),
    school: stringValue(record.school),
    institution: stringValue(record.institution),
    howpublished: stringValue(record.howpublished ?? record.howPublished),
    note: stringValue(record.note),
    doi: stringValue(record.doi),
    url: stringValue(record.url)
  };
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

function normalizeAuthors(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(authorName).filter(Boolean);
  const text = authorName(value);
  return text ? text.split(/\s+and\s+/i).map((item) => item.trim()).filter(Boolean) : [];
}

function authorName(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (!isRecord(value)) return "";
  const name = stringValue(value.name);
  if (name) return name;
  const given = stringValue(value.given);
  const family = stringValue(value.family);
  return [given, family].filter(Boolean).join(" ").trim();
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    const text = cleanReferenceValue(String(value));
    return text || undefined;
  }
  return undefined;
}

function findBalancedBraceEnd(content: string, openingIndex: number): number {
  let depth = 0;
  let escaped = false;
  for (let index = openingIndex; index < content.length; index++) {
    const char = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function readBibFieldValue(body: string, start: number): { value: string; end: number } | undefined {
  const first = body[start];
  if (first === "{") {
    let depth = 1;
    let escaped = false;
    for (let index = start + 1; index < body.length; index++) {
      const char = body[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "{") depth++;
      if (char === "}") {
        depth--;
        if (depth === 0) return { value: body.slice(start + 1, index), end: index + 1 };
      }
    }
    return { value: body.slice(start + 1), end: body.length };
  }
  if (first === "\"") {
    let escaped = false;
    for (let index = start + 1; index < body.length; index++) {
      const char = body[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") return { value: body.slice(start + 1, index), end: index + 1 };
    }
    return { value: body.slice(start + 1), end: body.length };
  }
  let end = start;
  while (end < body.length && body[end] !== "," && body[end] !== "\n") end++;
  return { value: body.slice(start, end), end };
}

function cleanReferenceValue(value: string): string {
  return value
    .replace(/\\texttt\{([^{}]*)\}/g, "$1")
    .replace(/\\&/g, "&")
    .replace(/\\_/g, "_")
    .replace(/[{}]/g, "")
    .replace(/---/g, "-")
    .replace(/--/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function formatReferenceAuthors(authors: string[]): string {
  const formatted = authors.map(formatReferenceAuthor);
  if (formatted.length <= 1) return formatted[0] ?? "";
  if (formatted.length === 2) return `${formatted[0]} & ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(", ")}, & ${formatted[formatted.length - 1]}`;
}

function formatReferenceAuthor(author: string): string {
  const clean = author.replace(/\s+/g, " ").trim();
  if (isInstitutionalReferenceAuthor(clean)) return clean;
  const comma = clean.indexOf(",");
  if (comma < 0) return clean;
  const family = clean.slice(0, comma).trim();
  const given = clean.slice(comma + 1).trim();
  const initials = given
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ.-]/g, ""))
    .filter(Boolean)
    .map((part) => part.includes(".") && part.length <= 4 ? part : `${part[0].toUpperCase()}.`)
    .join(" ");
  return initials ? `${family}, ${initials}` : family;
}

function isInstitutionalReferenceAuthor(author: string): boolean {
  return /archivo|asociaci[oó]n|centro|direcci[oó]n|google|gobierno|ign|inei|ingemmet|instituto|ministerio|minam|municipalidad|proyecto|senamhi|sernanp|servicio|universidad/i.test(author);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
