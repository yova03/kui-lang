import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CompileAbortedError, compileToNativePdf } from "../src/core/compiler.js";

describe("compileToNativePdf", () => {
  it("aborts before rendering when the input cannot be read", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "kui-missing-"));

    await expect(compileToNativePdf("does-not-exist.kui", { cwd, outputDir: "build" }))
      .rejects.toBeInstanceOf(CompileAbortedError);

    expect(existsSync(path.join(cwd, "build", "does-not-exist.pdf"))).toBe(false);
  });
});
