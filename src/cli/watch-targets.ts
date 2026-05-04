import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DocumentNode } from "../core/ast.js";
import { parseKui } from "../parser/kui-parser.js";
import { auditDocumentAssets } from "../semantic/assets.js";
import { normalizeReferenceSources } from "../semantic/bibliography.js";

export function collectWatchTargetFiles(document: DocumentNode, sourceDir: string): string[] {
  const sourceFiles = document.sourceFiles.map((file) => path.resolve(file));
  const bibliographyFiles = normalizeReferenceSources(document.frontmatter?.data)
    .map((source) => path.resolve(sourceDir, source.path));
  const assetFiles = collectAssetWatchFiles(document, sourceDir);
  return [...new Set([...sourceFiles, ...bibliographyFiles, ...assetFiles])];
}

function collectAssetWatchFiles(document: DocumentNode, sourceDir: string): string[] {
  if (document.sourceFiles.length === 0) {
    return auditDocumentAssets(document, { cwd: sourceDir, includeCaptionDiagnostics: false }).watchedFiles;
  }

  const files: string[] = [];
  for (const sourceFile of document.sourceFiles) {
    if (!existsSync(sourceFile)) continue;
    const sourceDocument = parseKui(readFileSync(sourceFile, "utf8"), { file: sourceFile });
    const audit = auditDocumentAssets(sourceDocument, {
      cwd: path.dirname(sourceFile),
      includeCaptionDiagnostics: false
    });
    files.push(...audit.watchedFiles);
  }
  return files;
}
