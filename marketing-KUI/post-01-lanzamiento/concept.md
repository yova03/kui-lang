# Post #01 — Lanzamiento de KUI

## Mensaje rector

**ES:** *La investigacion academica no deberia luchar contra un compilador.*
**EN:** *Academic research shouldn't fight its compiler.*

KUI es un lenguaje para escribir tesis y papers con la sobriedad de una bitacora: sintaxis legible, PDF nativo, sin LaTeX. Una linea de texto se vuelve una figura numerada, un grafico, una tabla con caption.

## Audiencia

- Tesistas y postulantes (pregrado, maestria, doctorado), especialmente hispanohablantes.
- Investigadores en ciencias sociales, humanidades, arqueologia, ingenieria.
- Divulgadores academicos que escriben con asistentes de IA y quieren un formato compacto en tokens.
- Comunidad de creadores que prefiere markdown sobre LaTeX.

## Propuestas de valor (3 bullets)

1. **Sintaxis legible.** `imagen kui-logo | Logotipo de KUI` reemplaza diez lineas de LaTeX.
2. **PDF nativo.** Sin compilador externo, sin distribuciones de 4 GB, sin errores de paquete faltante.
3. **Compacto en tokens.** Pensado para escribir con LLMs: menos sintaxis ceremonial = menos tokens por pagina.

## Pruebas concretas

- Tesis modular real en `examples/tesis-arqueologia-unsaac/` (UNSAAC, Cusco). Capitulos en archivos separados, bibliografia, indice y figuras automaticas.
- `examples/kui-muestrario-completo.kui` muestra graficos, tablas, formulas, kpis, cronogramas y firmas en un solo archivo de 100 lineas.
- Snippet incluido en este post: `snippet/demo.kui`.

## CTA

- **Primario:** `VER EL ARCHIVO` → `{REPO_URL}` (repositorio publico).
- **Secundario:** `LEER LA BITACORA` → `{LANDING_URL}` (README del proyecto).

## Hashtags

ES: `#KUI` `#Investigacion` `#Tesis` `#PDF` `#OpenSource` `#Arqueologia` `#UNSAAC`
EN: `#KUI` `#Research` `#Thesis` `#OpenSource` `#PDF` `#LaTeXAlternative`

(Maximo 5 hashtags por post para no romper la sobriedad.)

## Alt text accesible (imagen del creativo)

**ES:** "Composicion editorial en blanco y negro: a la izquierda, una ilustracion monoline de una mano sosteniendo un fragmento de papel doblado; a la derecha, el titular 'La investigacion academica no deberia luchar contra un compilador' y un bloque de codigo .kui en monoespaciada."

**EN:** "Black and white editorial composition: on the left, a monoline drawing of a hand holding a folded paper fragment; on the right, the headline 'Academic research shouldn't fight its compiler' and a `.kui` code block in monospace."

## Tests de consistencia aplicados

| Test | Resultado esperado |
|---|---|
| Reconocimiento de marca | Si — paleta B/N, monoline, Space Grotesk + IBM Plex Mono. |
| Reduccion formal | Una sola idea por pieza: legibilidad vs. ceremonia. |
| Claridad | El hook se entiende en menos de 3 segundos. |
| Tono | Sobrio, sin superlativos, sin emojis. |
| Disciplina cromatica | Solo `#000`, `#FFF`, `#F2F2F0`, `#6B6B66`. |
| Sin logo | Si quitamos el logotipo, la pieza sigue parecida a Daril Yovani por la tipografia, el espacio y el monoline. |

## Lista de archivos del post

- `concept.md` (este archivo).
- `copy/x-{es,en}.md`, `copy/linkedin-{es,en}.md`, `copy/instagram-{es,en}.md`, `copy/threads-{es,en}.md`.
- `visual/mockup-square-1080.html`, `visual/mockup-landscape-1200x630.html`, `visual/mockup-portrait-1080x1350.html`, `visual/layout-ascii.md`.
- `snippet/demo.kui`.
