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
  const author = entry.author.length > 0 ? entry.author.join(", ") : entry.key;
  const year = entry.year ? ` (${entry.year}).` : ".";
  const title = entry.title ? ` ${entry.title}.` : "";
  const container = entry.journal ?? entry.booktitle ?? entry.publisher ?? "";
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
  const entryPattern = /@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)\n\}/g;
  for (const match of content.matchAll(entryPattern)) {
    const key = match[2];
    if (keys.has(key)) continue;
    keys.add(key);
    const fields = parseBibFields(match[3]);
    entries.push({
      key,
      type: match[1],
      title: fields.title,
      author: normalizeAuthors(fields.author),
      year: fields.year,
      journal: fields.journal,
      publisher: fields.publisher,
      booktitle: fields.booktitle,
      doi: fields.doi,
      url: fields.url
    });
  }
  return entries;
}

function parseBibFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const fieldPattern = /(\w+)\s*=\s*[{"]([^}"]+)[}"]/g;
  for (const match of body.matchAll(fieldPattern)) fields[match[1].toLowerCase()] = match[2];
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
    const text = String(value).trim();
    return text || undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
