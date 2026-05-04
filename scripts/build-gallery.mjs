import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "examples/gallery/gallery.json");
const outputDir = path.join(root, "build/gallery");
const previewDir = path.join(root, "docs/gallery/previews");
const cliPath = path.join(root, "dist/src/cli/index.js");

if (!existsSync(manifestPath)) {
  throw new Error(`Missing gallery manifest: ${path.relative(root, manifestPath)}`);
}

if (!existsSync(cliPath)) {
  throw new Error("Missing compiled CLI. Run npm run build before building the gallery.");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const demos = Array.isArray(manifest.demos) ? manifest.demos : [];
if (demos.length === 0) throw new Error("Gallery manifest has no demos.");

mkdirSync(outputDir, { recursive: true });
mkdirSync(previewDir, { recursive: true });

const hasPdfToPpm = commandWorks("pdftoppm", ["-v"]);
const results = [];

for (const demo of demos) {
  const source = path.join(root, demo.source);
  if (!existsSync(source)) throw new Error(`Missing demo source: ${demo.source}`);

  execFileSync(process.execPath, [cliPath, "build", source, "-o", outputDir], {
    cwd: root,
    stdio: "inherit"
  });

  const pdfPath = path.join(outputDir, `${path.basename(source, path.extname(source))}.pdf`);
  if (!existsSync(pdfPath)) throw new Error(`Expected PDF was not generated: ${path.relative(root, pdfPath)}`);

  let preview = "";
  if (hasPdfToPpm && demo.preview) {
    const previewPath = path.join(root, demo.preview);
    mkdirSync(path.dirname(previewPath), { recursive: true });
    const targetBase = previewPath.replace(/\.png$/i, "");
    const previewPage = normalizePreviewPage(demo.previewPage);
    execFileSync("pdftoppm", ["-png", "-r", "144", "-f", previewPage, "-l", previewPage, "-singlefile", pdfPath, targetBase], {
      cwd: root,
      stdio: "ignore"
    });
    preview = demo.preview;
  }

  results.push({
    id: demo.id,
    pdf: path.relative(root, pdfPath).replace(/\\/g, "/"),
    preview
  });
}

console.log(JSON.stringify({
  outputDir: path.relative(root, outputDir).replace(/\\/g, "/"),
  previews: hasPdfToPpm ? "generated" : "skipped: pdftoppm not available",
  demos: results
}, null, 2));

function commandWorks(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.error === undefined;
}

function normalizePreviewPage(value) {
  const page = Number(value ?? 1);
  if (!Number.isFinite(page) || page < 1) return "1";
  return String(Math.floor(page));
}
