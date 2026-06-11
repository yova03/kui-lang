# Changelog

Todas las novedades relevantes de KUI se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el
proyecto usa [versionado semántico](https://semver.org/lang/es/).

## [Unreleased]

### Added

- Archivo `LICENSE` (MIT) en el repositorio.
- CI con GitHub Actions: typecheck, tests, build, compilación de todos los
  ejemplos a PDF y verificación del paquete npm instalable.
- Empaquetado npm publicable: el paquete incluye solo `dist/` (binario `kui`,
  fuentes embebidas), con `prepublishOnly` que exige typecheck, tests y build.
- Tests E2E del CLI (`new` -> `check` -> `pdf` sobre un proyecto temporal) y
  tests de regresión de layout que compilan todos los ejemplos y comparan
  páginas, encabezados, labels y notas al pie contra snapshots.

### Changed

- El renderer PDF nativo (`src/pdf/native-pdf.ts`, 4,296 líneas) se dividió
  en 11 módulos enfocados (fuentes, portadas, bloques, tablas, bloques
  semánticos, planos UTM, índices, numeración/encabezados, inline y layout)
  sin cambios de comportamiento; el API público se mantiene.

### Removed

- `marketing-KUI/` (mockups y material de redes) se retiró del repositorio
  del compilador; queda disponible en el historial de git.

## [0.1.0] - 2026-05-04

Cierre del MVP local v0.1: flujo nativo `.kui -> AST -> diagnósticos -> PDF`.

### Added

- Parser KUI con frontmatter simple, aliases en español y comandos cortos
  (`tabla`, `grafico`, `formula`, `nota`, `kpis`, `imagen`, `cuadrado`).
- AST semántico con validación de referencias cruzadas, citas, bibliografía,
  assets, tablas y accesibilidad (`kui check` con filtros por frente).
- Renderer PDF nativo con PDFKit: portadas, TOC, tablas, gráficos, fórmulas,
  cajas, KPIs, planos UTM con grilla y fuentes embebidas.
- Formato de referencias `.kref` (YAML) además de `.bib`.
- 8 plantillas integradas: `paper-APA` (default), `paper-IEEE`, `tesis-unsaac`
  (modular multiarchivo), `informe-operativo`, `brochure-visual`,
  `plano-tecnico`, `carta-institucional`, `article-digital-economy`.
- CLI: `new`, `check`, `assets check`, `pdf`, `build`, `watch`, `templates`,
  `doctor`, `export --format tex`, `clean`.
- Cache de assets remotos con reuso offline e inspección de dimensiones/DPI.
- UI local del compilador (fuente, AST, símbolos, diagnósticos, PDF).
- Exportación LaTeX opcional para interoperabilidad.
- Galería de ejemplos reproducibles y documentación pública
  (`README.md`, `docs/QUICKSTART.md`, `docs/GALLERY.md`, `docs/MVP-CLOSURE.md`).
