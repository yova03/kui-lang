import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";
import { describe, expect, it } from "vitest";
import { compileToNativePdf } from "../src/core/compiler.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exampleFiles = fg.sync(["examples/*.kui", "examples/gallery/*.kui"], { cwd: repoRoot }).sort();

function countPdfPages(bytes: Buffer): number {
  return bytes.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

describe("examples render regression", () => {
  it("finds the example corpus", () => {
    expect(exampleFiles.length).toBeGreaterThanOrEqual(11);
  });

  it.each(exampleFiles)("compiles %s without diagnostics and matches the recorded layout", async (file) => {
    const outputDir = mkdtempSync(path.join(tmpdir(), "kui-regression-"));

    const { output } = await compileToNativePdf(file, { cwd: repoRoot, outputDir });
    const bytes = readFileSync(output.pdfPath);

    expect(output.diagnostics).toHaveLength(0);
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");

    const layout = {
      pages: countPdfPages(bytes),
      headings: output.pageMap.headings.map((heading) => `${heading.title} -> ${heading.page}`),
      labels: Object.fromEntries(
        Object.entries(output.pageMap.labels).map(([id, info]) => [id, info.page])
      ),
      footnotes: output.pageMap.footnotes
    };

    expect(layout).toMatchSnapshot();
  }, 120_000);
});
