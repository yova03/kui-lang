# LinkedIn — ES (post editorial, ~210 palabras)

> Adjuntar imagen `mockup-landscape-1200x630.png`. Reemplazar `https://github.com/yova03/kui-lang` antes de publicar.

---

La investigación académica no debería luchar contra un compilador.

Durante años, escribir una tesis o un paper formal implicó aprender LaTeX antes de aprender a investigar: instalar distribuciones de gigabytes, leer errores que ningún humano debería descifrar, y abandonar la mitad de las ideas porque el formato pesaba más que el argumento.

Por eso construí **KUI**: un lenguaje de documentos académicos con la sobriedad de una bitácora de campo. Una línea de texto se convierte en una figura numerada, en una tabla con caption, en un gráfico nativo. El PDF se compila directo, sin LaTeX y sin HTML intermedio.

Tres decisiones de diseño guían el proyecto:

— **Sintaxis legible.** `imagen kui-logo | Logotipo de KUI` reemplaza diez líneas de marcado.
— **PDF nativo.** Renderer propio en Node, sin dependencias externas pesadas.
— **Compacto en tokens.** Pensado para escribir junto a un LLM: menos ceremonia, menos costo, más archivo.

La primera tesis publicada con KUI es una investigación de arqueología en la Universidad Nacional San Antonio Abad del Cusco (UNSAAC). Capítulos modulares, bibliografía, índice y figuras automáticas, todo desde un solo `main.kui`.

KUI es de código abierto. Validador, plantillas y renderer están disponibles para revisión y contribución.

VER EL ARCHIVO → https://github.com/yova03/kui-lang
