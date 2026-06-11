import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
const kuiCli = path.join(repoRoot, "src", "cli", "index.ts");

function runKui(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [tsxCli, kuiCli, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("kui CLI end to end", () => {
  it("runs new -> check -> pdf on a fresh project", () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "kui-e2e-"));

    const created = runKui(["new", "demo", "--template", "paper-APA"], workDir);
    expect(created.stderr).toBe("");
    expect(created.status).toBe(0);
    expect(created.stdout).toContain("Proyecto KUI creado");
    expect(existsSync(path.join(workDir, "demo", "main.kui"))).toBe(true);
    expect(existsSync(path.join(workDir, "demo", "kui.toml"))).toBe(true);
    expect(existsSync(path.join(workDir, "demo", "referencias.kref"))).toBe(true);

    const checked = runKui(["check", "main.kui"], path.join(workDir, "demo"));
    expect(checked.status).toBe(0);
    expect(checked.stdout).toContain("Sin diagnósticos");

    const compiled = runKui(["pdf", "main.kui"], path.join(workDir, "demo"));
    expect(compiled.status).toBe(0);

    const pdfPath = path.join(workDir, "demo", "build", "main.pdf");
    expect(existsSync(pdfPath)).toBe(true);
    expect(readFileSync(pdfPath).subarray(0, 4).toString()).toBe("%PDF");
  }, 120_000);

  it("rejects unknown templates with a close-match suggestion", () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "kui-e2e-bad-template-"));

    const result = runKui(["new", "demo", "--template", "paper-APAA"], workDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("paper-APA");
    expect(existsSync(path.join(workDir, "demo"))).toBe(false);
  }, 120_000);

  it("reports a non-zero exit code when the input file does not exist", () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "kui-e2e-missing-"));

    const result = runKui(["pdf", "no-existe.kui"], workDir);

    expect(result.status).not.toBe(0);
  }, 120_000);
});
