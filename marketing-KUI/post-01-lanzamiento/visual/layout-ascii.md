# Layout ASCII — Post 01 Lanzamiento

Boceto referencial para reconstruir cada mockup sin abrir el HTML. Espacio negativo dominante. Solo blanco, negro y `#F2F2F0` (`surfaceSoft`).

---

## Square 1080×1080 (Instagram feed, X card cuadrada)

```
+--------------------------------------------------------+
| DARIL YOVANI · KUI         POST 01 / LANZAMIENTO 03.05 |  <- topbar (IBM Plex Mono caps)
|                                                        |
|                                                        |
|                  +---------------+                     |
|                  |               |                     |
|                  |   ILUSTRACION |                     |
|                  |   MONOLINE    |                     |
|                  |  (mano sost.  |                     |
|                  |   fragmento)  |                     |
|                  +---------------+                     |
|                                                        |
|                                                        |
|  La investigacion no deberia luchar contra            |  <- headline-display Space Grotesk 72px
|  un compilador.                                       |
|                                                        |
|  KUI: un lenguaje para escribir tesis y papers.       |  <- subhead Inter 22px
|  PDF nativo, sin LaTeX.                               |
|                                                        |
|  +------------------------------------------------+   |
|  | imagen kui-logo | Logotipo de KUI              |   |  <- snippet IBM Plex Mono 18px
|  +------------------------------------------------+   |     surfaceSoft + border
|                                                        |
| [INVESTIGACION] [PDF NATIVO] [SIN LATEX] [VER ARCHIVO]|  <- chips + CTA
+--------------------------------------------------------+
```

Distribucion vertical: topbar 88px → ilustracion ~440px → contenido ~464px → footer 88px.

---

## Landscape 1200×630 (LinkedIn share, X link card, Twitter)

```
+-----------------------------------------------------------------+
| DARIL YOVANI · KUI            POST 01 / LANZAMIENTO 03.05.2026  |
|                                                                  |
| +----------------+   La investigacion no deberia luchar          |
| |                |   contra un compilador.                       |
| |  ILUSTRACION   |                                               |
| |  MONOLINE      |   KUI: un lenguaje para escribir tesis        |
| |  (mano sost.   |   y papers. PDF nativo, sin LaTeX,            |
| |   fragmento)   |   compacto en tokens.                         |
| |                |                                               |
| +----------------+   +-------------------------------------+    |
|                      | imagen kui-logo | Logotipo de KUI   |    |
|                      | tabla Capacidades                   |    |
|                      | Elemento; Estado                    |    |
|                      | PDF nativo; Activo                  |    |
|                      +-------------------------------------+    |
|                                                                  |
| [INVESTIGACION] [PDF NATIVO] [SIN LATEX] [TESIS]  [VER ARCHIVO] |
+-----------------------------------------------------------------+
```

Distribucion: 380px ilustracion + 56px gutter + resto contenido. Headline 48px.

---

## Portrait 1080×1350 (Instagram portrait/carousel, Threads)

```
+--------------------------------------------------------+
| DARIL YOVANI · KUI         POST 01 / LANZAMIENTO       |
|                                                        |
|                                                        |
|                  +---------------+                     |
|                  |               |                     |
|                  |   ILUSTRACION |                     |
|                  |   MONOLINE    |                     |
|                  |   420 x 420   |                     |
|                  +---------------+                     |
|                                                        |
|                                                        |
|  La investigacion no deberia luchar contra            |  <- 64px Space Grotesk
|  un compilador.                                       |
|                                                        |
|  KUI: un lenguaje para escribir tesis y papers.       |
|  PDF nativo. Sin LaTeX.                               |
|                                                        |
|  +------------------------------------------------+   |
|  | imagen kui-logo | Logotipo de KUI              |   |
|  |                                                |   |
|  | tabla Capacidades                              |   |
|  | Elemento; Estado                               |   |
|  | PDF nativo; Activo                             |   |
|  +------------------------------------------------+   |
|                                                        |
|                                                        |
| [INVESTIGACION] [PDF NATIVO] [SIN LATEX]  [VER ARCHIVO]|
+--------------------------------------------------------+
```

Distribucion: topbar 80px → ilustracion ~420px → headline → subhead → snippet → footer 80px. Padding lateral 80px.

---

## Especificaciones tipograficas exactas

| Rol | Familia | Tamano por mockup | Peso | Tracking |
|---|---|---|---|---|
| `headline-display` | Space Grotesk | 72px (square) / 48px (landscape) / 64px (portrait) | 700 | -0.04em / -0.035em |
| `subhead` | Inter | 18–22px | 400 | -0.01em |
| `snippet` | IBM Plex Mono | 14–18px | 400 | +0.02em |
| `chip / cta` | IBM Plex Mono | 11–12px | 600 | +0.12em (UPPER) |
| `topbar / footer meta` | IBM Plex Mono | 12–13px | 400/600 | +0.02em / +0.12em |

## Reglas de color (recordatorio)

- Fondo principal: `#FFFFFF`.
- Snippet/chips background: `#F2F2F0`.
- Borde: `#D9D9D6`.
- Linea, texto, ilustracion: `#000000`.
- Texto secundario: `#6B6B66`.
- **Nada mas. Sin acento. Sin gradiente. Sin sombra.**
