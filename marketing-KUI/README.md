# marketing-KUI

Bitacora de difusion del lenguaje **KUI**. Cada post vive en su propia carpeta `post-NN-slug/` y contiene tres tipos de archivo: copy (texto por red social), visual (mockups y layouts) y snippet (codigo `.kui` verificable que aparece en el creativo).

La marca de superficie es **Daril Yovani** (ver `brand-quickref.md`). KUI es un proyecto firmado por esa marca personal, asi que cada pieza debe poder pasar el test del DESIGN.md: *si quitamos el logo, ¿se sigue viendo como Daril Yovani?*

## Convenciones

- Carpeta por post: `post-NN-slug/` (ej. `post-01-lanzamiento/`).
- Copy en `copy/<plataforma>-<idioma>.md`.
- Mockups en `visual/mockup-<ratio>.html`, autocontenidos, sin dependencias.
- Snippet de codigo demo en `snippet/demo.kui`, debe compilar contra el CLI del repo.
- Idiomas: espanol primero, ingles como espejo (no traduccion literal).
- URLs: usar placeholders `{REPO_URL}` y `{LANDING_URL}` y reemplazar al publicar.

## Reglas no negociables (de `brand-quickref.md`)

- Solo blanco, negro y grises funcionales. Sin acentos cromaticos.
- Ilustraciones monoline, linea negra continua sobre fondo blanco.
- Tipografias: Space Grotesk (headlines), Inter (body), IBM Plex Mono (labels y archivo).
- Voz sobria, reflexiva, precisa. Sin frases promocionales vacias. Sin emojis.
- Espacio negativo como elemento de identidad: si parece lleno, quitar antes de anadir.

## Como exportar un creativo

1. Abrir `post-NN-slug/visual/mockup-<ratio>.html` en el navegador (Chrome o Safari) con red activa para que carguen las Google Fonts.
2. DevTools → Toggle device toolbar → poner el viewport exacto del nombre del archivo (1080×1080, 1200×630, 1080×1350).
3. DevTools → Run command → `Capture full size screenshot`.
4. Guardar el PNG fuera del repo o en una carpeta `out/` ignorada por git.

## Como publicar un post

1. Reemplazar `{REPO_URL}` y `{LANDING_URL}` en cada `copy/*.md` por las URLs reales.
2. Capturar los mockups (paso anterior) y, si se quiere, sustituir el placeholder monoline `<svg>` por una ilustracion final generada con el prompt maestro del DESIGN.md.
3. Pegar el copy en cada red, adjuntando la imagen del ratio correspondiente:
   - X / Twitter: landscape 1200×630.
   - LinkedIn: landscape 1200×630.
   - Instagram feed: square 1080×1080. Carrusel: portrait 1080×1350 por slide.
   - Threads: portrait 1080×1350 o square 1080×1080.

## Indice de posts

| # | Carpeta | Estado | Tema |
|---|---|---|---|
| 01 | `post-01-lanzamiento/` | borrador | Anuncio publico de KUI: PDF nativo sin LaTeX para difundir investigacion. |
