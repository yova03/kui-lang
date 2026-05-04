import { existsSync } from "node:fs";
import path from "node:path";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];
const IMAGE_DIRS = ["figuras", "assets"];

export interface ResolveAssetOptions {
  cwd: string;
  sourceFile?: string;
}

export function resolveAssetPath(rawPath: string, options: ResolveAssetOptions): string {
  if (/^https?:\/\//.test(rawPath) || path.isAbsolute(rawPath)) return rawPath;

  const cleanPath = rawPath.split(/[?#]/)[0] ?? rawPath;
  const baseDirs = unique([
    options.sourceFile ? path.dirname(options.sourceFile) : undefined,
    options.cwd
  ]);

  for (const candidate of assetCandidates(cleanPath, baseDirs)) {
    if (existsSync(candidate)) return candidate;
  }

  return path.resolve(baseDirs[0] ?? options.cwd, cleanPath);
}

function assetCandidates(rawPath: string, baseDirs: string[]): string[] {
  const candidates: string[] = [];
  const hasDirectory = /[\\/]/.test(rawPath);
  const hasExtension = Boolean(path.extname(rawPath));

  for (const baseDir of baseDirs) {
    candidates.push(path.resolve(baseDir, rawPath));
    if (!hasDirectory) {
      for (const extension of hasExtension ? [""] : IMAGE_EXTENSIONS) {
        candidates.push(path.resolve(baseDir, `${rawPath}${extension}`));
      }
      for (const imageDir of IMAGE_DIRS) {
        candidates.push(path.resolve(baseDir, imageDir, rawPath));
        for (const extension of hasExtension ? [""] : IMAGE_EXTENSIONS) {
          candidates.push(path.resolve(baseDir, imageDir, `${rawPath}${extension}`));
        }
      }
      const parentDir = path.dirname(baseDir);
      if (parentDir !== baseDir) {
        for (const imageDir of IMAGE_DIRS) {
          candidates.push(path.resolve(parentDir, imageDir, rawPath));
          for (const extension of hasExtension ? [""] : IMAGE_EXTENSIONS) {
            candidates.push(path.resolve(parentDir, imageDir, `${rawPath}${extension}`));
          }
        }
      }
    }
  }

  return unique(candidates);
}

function unique<T>(values: Array<T | undefined>): T[] {
  return [...new Set(values.filter((value): value is T => value !== undefined))];
}
