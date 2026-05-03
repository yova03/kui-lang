# KUI

KUI es un lenguaje de documentos inspirado en Markdown para escribir trabajos academicos, informes tecnicos y documentos estructurados con salida PDF nativa, sin depender de LaTeX para compilar el PDF final.

El proyecto incluye parser, AST semantico, validaciones, plantillas, renderer PDF con PDFKit, exportacion LaTeX opcional y una UI local para inspeccionar el flujo completo del compilador.

## Que ofrece

- Sintaxis legible basada en archivos `.kui`.
- Frontmatter YAML para metadatos, plantilla, autores, bibliografia y configuracion.
- Validacion de referencias, citas, assets, campos requeridos y estructura.
- Renderer PDF nativo para generar documentos desde Node.js.
- Exportacion `.tex` opcional para interoperabilidad.
- Plantillas integradas para articulos, tesis e informes genericos.
- Interfaz local para revisar fuente, AST, simbolos, diagnosticos y PDF generado.

## Requisitos

- Node.js 20 o superior.
- npm.

## Instalacion

```bash
npm install
npm run build
```

## Uso rapido

```bash
npm run dev -- check examples/paper.kui
npm run dev -- pdf examples/paper.kui
npm run dev -- doctor
```

Los PDF generados se guardan en `build/`.

## CLI

Durante desarrollo puedes usar:

```bash
npm run dev -- new mi-documento --template paper-APA
npm run dev -- check main.kui
npm run dev -- pdf main.kui
npm run dev -- build main.kui
npm run dev -- watch main.kui
npm run dev -- templates
npm run dev -- export main.kui --format tex
```

Despues de compilar el proyecto, el binario queda disponible desde `dist/src/cli/index.js`.

## UI local

```bash
npm run ui -- --port 4321
```

Luego abre:

```text
http://localhost:4321/
```

La UI permite inspeccionar ejemplos, frontmatter, AST, simbolos, diagnosticos y el PDF resultante.

## Ejemplo minimo

```kui
---
title: "Documento KUI"
author: "Equipo KUI"
date: 2026
language: es
template: paper-APA
refs: ./referencias.kref
---

:::resumen
Este documento demuestra una estructura minima en KUI.
:::

:indice

# Introduccion {#sec:intro}

KUI compila documentos estructurados a PDF nativo.

:bibliografia
```

## Referencias KUIRef

KUI acepta `refs:` con archivos `.kref`, un formato YAML simple para reemplazar `.bib` en el flujo nativo:

```yaml
garcia2020:
  type: article
  title: Wari en Cusco
  author:
    - Ana García
  year: 2020
  journal: Revista Andina
```

`.bib` sigue soportado para compatibilidad con BibTeX/Zotero, pero los ejemplos nativos usan `.kref`.

## Imágenes simples

Además de Markdown (`![caption](ruta)`), KUI acepta un comando corto:

```kui
La figura @fig:kui-compiler-pipeline muestra el flujo completo.

:img ./figuras/kui-compiler-pipeline.png | Flujo del compilador KUI
```

El label se genera automáticamente desde el nombre del archivo: `fig:kui-compiler-pipeline`.

## Plantillas incluidas

- `paper-IEEE`: articulo academico estilo IEEE.
- `paper-APA`: articulo academico estilo APA.
- `tesis-unsaac`: plantilla base para tesis.
- `informe-operativo`: informe tecnico u operativo generico.
- `article-digital-economy`: articulo academico de economia digital.

## Estructura

```text
src/core       AST, diagnosticos y modelo de proyecto
src/parser     parser KUI y normalizacion de aliases
src/semantic   validadores y tablas de simbolos
src/pdf        renderer PDF nativo
src/latex      exportador LaTeX opcional
src/templates  registro de plantillas
src/cli        interfaz de linea de comandos
src/ui         UI local del compilador
docs           documentacion tecnica
examples       archivos KUI de ejemplo
tests          pruebas automatizadas
```

## Scripts

```bash
npm run check    # verificacion TypeScript sin emitir archivos
npm test         # pruebas automatizadas
npm run build    # compila a dist/
npm run clean    # limpia dist/ y build/
```

## Licencia

MIT
