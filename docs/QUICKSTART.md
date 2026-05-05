# KUI Quickstart v0.1

This guide gets a new contributor from source checkout to a generated PDF.

## Requirements

- Node.js 20 or newer.
- npm.
- Docker and Docker Compose, optional.

LaTeX is optional. The main v0.x path renders PDF natively with PDFKit.

## Install And Build

```bash
npm install
npm run build
```

Run a health check:

```bash
npm run dev -- doctor
```

`pdflatex` and `biber` may appear as optional `INFO` entries. They are only needed for LaTeX export interoperability.

## Run Without Local Installation

If you do not want to install Node.js or npm locally, use Docker instead:

```bash
docker compose build
docker compose run --rm kui doctor
docker compose run --rm kui check examples/paper.kui
docker compose run --rm kui pdf examples/paper.kui
```

Generated PDFs and caches are written into the repository `build/` directory through the bind mount.

To start the inspection UI:

```bash
docker compose up kui-ui
```

Then open:

```text
http://localhost:4321/
```

## Compile The First PDF

```bash
npm run dev -- check examples/paper.kui
npm run dev -- pdf examples/paper.kui
```

The output is written to:

```text
build/paper.pdf
```

## Create A New Project

```bash
npm run dev -- new mi-documento --template paper-APA
cd mi-documento
node ..\dist\src\cli\index.js check
node ..\dist\src\cli\index.js pdf
```

From the repository root you can also use:

```bash
npm run dev -- pdf mi-documento/main.kui
```

For a thesis scaffold:

```bash
npm run dev -- new mi-tesis --template tesis-unsaac
npm run dev -- pdf mi-tesis/main.kui
```

## Validate By Area

`check` validates all areas by default:

```bash
npm run dev -- check main.kui
```

Scoped checks:

```bash
npm run dev -- check main.kui --refs
npm run dev -- check main.kui --bib
npm run dev -- check main.kui --assets
npm run dev -- check main.kui --tables
npm run dev -- check main.kui --accessibility
```

Diagnostics are grouped by file and sorted by severity. Common typos in template ids, cross-reference labels and citation keys include close-match suggestions.

## Images And Assets

Supported raster formats in the native PDF MVP:

- PNG
- JPG/JPEG
- WEBP

SVG and PDF figures are detected and reported as unsupported for the native MVP. Convert them to PNG/JPG/WEBP before rendering, or keep them for a future asset conversion phase.

Prepare and inspect the asset cache:

```bash
npm run dev -- assets check main.kui
```

This command:

- resolves local images from the source folder, `figuras/` and `assets/`;
- copies supported local images into `build/cache/assets/`;
- downloads remote images when the network is available;
- reuses the remote cache if the network later fails;
- reports dimensions and declared DPI for PNG/JPG/WEBP.

## Watch Mode

```bash
npm run dev -- watch main.kui
```

Watch mode observes:

- the main `.kui`;
- included files;
- declared `refs:` and `bib:` files;
- existing local figure assets;
- `kui.toml` when the command is run from a project folder.

## Included Templates

```bash
npm run dev -- templates
```

Current templates:

- `paper-APA`
- `paper-IEEE`
- `tesis-unsaac`
- `informe-operativo`
- `brochure-visual`
- `plano-tecnico`
- `article-digital-economy`

## MVP Boundaries

KUI v0.1 is ready for local authoring and review of native PDFs. The following are intentionally deferred:

- VS Code/LSP extension.
- Advanced imports from `.tex`, `.docx` and `.ipynb`.
- HTML, EPUB and DOCX backends.
- Automatic SVG/PDF figure conversion.
- PDF/A, PDF/UA, digital signature and automated SUNEDU validation.
- Rust typography/layout engine v1.0.
