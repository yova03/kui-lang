import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseKui } from "../src/parser/kui-parser.js";
import { auditAndCacheDocumentAssets, auditDocumentAssets, resolveCachedAssetPath } from "../src/semantic/assets.js";

describe("auditDocumentAssets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves local figures and copies supported assets to cache", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "kui-assets-"));
    mkdirSync(path.join(cwd, "figuras"));
    writeFileSync(path.join(cwd, "figuras", "logo.png"), "not-a-real-image", "utf8");
    const sourceFile = path.join(cwd, "main.kui");
    const document = parseKui("![Logo KUI](logo)\n", { file: sourceFile });

    const audit = auditDocumentAssets(document, {
      cwd,
      outputDir: "build",
      ensureCache: true,
      includeCaptionDiagnostics: true
    });

    expect(audit.items).toHaveLength(1);
    expect(audit.items[0].status).toBe("ok");
    expect(audit.items[0].resolvedPath).toBe(path.join(cwd, "figuras", "logo.png"));
    expect(audit.items[0].cachePath && existsSync(audit.items[0].cachePath)).toBe(true);
    expect(audit.watchedFiles).toEqual([path.join(cwd, "figuras", "logo.png")]);
    expect(audit.diagnostics.diagnostics).toHaveLength(0);
  });

  it("reports missing, remote and unsupported figure assets", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "kui-assets-"));
    mkdirSync(path.join(cwd, "figuras"));
    writeFileSync(path.join(cwd, "figuras", "diagram.svg"), "<svg />", "utf8");
    const document = parseKui([
      "![Falta](missing.png)",
      "",
      "![Remota](https://example.com/image.png)",
      "",
      "![Diagrama](diagram)"
    ].join("\n"), { file: path.join(cwd, "main.kui") });

    const audit = auditDocumentAssets(document, { cwd, includeCaptionDiagnostics: true });
    const codes = audit.diagnostics.diagnostics.map((diagnostic) => diagnostic.code);

    expect(audit.items.map((item) => item.status)).toEqual(["missing", "remote", "unsupported"]);
    expect(codes).toContain("KUI-W031");
    expect(codes).toContain("KUI-I034");
    expect(codes).toContain("KUI-W033");
    expect(audit.watchedFiles).toEqual([path.join(cwd, "figuras", "diagram.svg")]);
  });

  it("warns when a raster image declares low DPI metadata", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "kui-assets-"));
    writeFileSync(path.join(cwd, "low.png"), lowDpiPng(100, 80, 72));
    const document = parseKui("![Baja resolucion](low.png)\n", { file: path.join(cwd, "main.kui") });

    const audit = auditDocumentAssets(document, { cwd, includeCaptionDiagnostics: true });
    const image = audit.items[0].image;
    const codes = audit.diagnostics.diagnostics.map((diagnostic) => diagnostic.code);

    expect(image).toEqual({ width: 100, height: 80, dpiX: 72, dpiY: 72 });
    expect(codes).toContain("KUI-W035");
  });

  it("downloads remote figures when preparing the asset cache", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "kui-assets-"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/png" }
    })));
    const document = parseKui("![Remota](https://example.com/chart)\n", { file: path.join(cwd, "main.kui") });

    const audit = await auditAndCacheDocumentAssets(document, {
      cwd,
      outputDir: "build",
      ensureCache: true,
      fetchRemote: true,
      includeCaptionDiagnostics: true
    });
    const remote = audit.items[0];
    const codes = audit.diagnostics.diagnostics.map((diagnostic) => diagnostic.code);

    expect(fetch).toHaveBeenCalledWith("https://example.com/chart");
    expect(remote.status).toBe("remote");
    expect(remote.format).toBe(".png");
    expect(remote.cachePath && existsSync(remote.cachePath)).toBe(true);
    expect(resolveCachedAssetPath("https://example.com/chart", path.join(cwd, "build"))).toBe(remote.cachePath);
    expect(codes).toContain("KUI-I034");
    expect(codes).toContain("KUI-I035");
  });

  it("reuses an existing remote cache entry when the network fails", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "kui-assets-"));
    const document = parseKui("![Remota](https://example.com/offline.png)\n", { file: path.join(cwd, "main.kui") });
    const first = await auditAndCacheDocumentAssets(document, {
      cwd,
      outputDir: "build",
      ensureCache: true,
      fetchRemote: true,
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" }
      }),
      includeCaptionDiagnostics: true
    });

    const second = await auditAndCacheDocumentAssets(document, {
      cwd,
      outputDir: "build",
      ensureCache: true,
      fetchRemote: true,
      fetchImpl: async () => new Response(null, { status: 503 }),
      includeCaptionDiagnostics: true
    });
    const codes = second.diagnostics.diagnostics.map((diagnostic) => diagnostic.code);

    expect(second.items[0].cachePath).toBe(first.items[0].cachePath);
    expect(codes).toContain("KUI-I036");
    expect(codes).not.toContain("KUI-W034");
  });
});

function lowDpiPng(width: number, height: number, dpi: number): Buffer {
  const pixelsPerMeter = Math.round(dpi / 0.0254);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const phys = Buffer.alloc(9);
  phys.writeUInt32BE(pixelsPerMeter, 0);
  phys.writeUInt32BE(pixelsPerMeter, 4);
  phys[8] = 1;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("pHYs", phys),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  return chunk;
}
