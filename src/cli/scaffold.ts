import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { findTemplate, listTemplates } from "../templates/registry.js";
import { closestMatch } from "../utils/suggestions.js";

export class KuiProjectExistsError extends Error {
  constructor(readonly projectPath: string) {
    super(`Ya existe: ${projectPath}`);
  }
}

export class KuiUnknownTemplateError extends Error {
  constructor(readonly template: string) {
    const templateIds = listTemplates().map((candidate) => candidate.id);
    const suggestion = closestMatch(template, templateIds);
    const suggestionText = suggestion ? ` Quizas quisiste decir "${suggestion}".` : "";
    super(`La plantilla "${template}" no esta instalada.${suggestionText} Disponibles: ${templateIds.join(", ")}`);
  }
}

export function createKuiProject(root: string, template: string): void {
  if (existsSync(root)) throw new KuiProjectExistsError(root);
  if (!findTemplate(template)) throw new KuiUnknownTemplateError(template);
  if (template === "tesis-unsaac") {
    createTesisUnsaacProject(root);
    return;
  }
  createDefaultProject(root, template);
}

function createDefaultProject(root: string, template: string): void {
  mkdirSync(path.join(root, "figuras"), { recursive: true });
  mkdirSync(path.join(root, "capitulos"), { recursive: true });
  writeFileSync(path.join(root, "kui.toml"), projectConfig(template), "utf8");
  writeFileSync(path.join(root, "referencias.kref"), sampleKref(), "utf8");
  writeFileSync(path.join(root, "main.kui"), sampleDocument(template), "utf8");
}

function createTesisUnsaacProject(root: string): void {
  mkdirSync(path.join(root, "contenido"), { recursive: true });
  mkdirSync(path.join(root, "figuras"), { recursive: true });
  mkdirSync(path.join(root, "planos"), { recursive: true });
  writeFileSync(path.join(root, "kui.toml"), projectConfig("tesis-unsaac"), "utf8");
  writeFileSync(path.join(root, "referencias.kref"), sampleKref(), "utf8");
  writeFileSync(path.join(root, "main.kui"), tesisMainDocument(), "utf8");

  for (const file of tesisContentFiles()) {
    writeFileSync(path.join(root, "contenido", file.name), file.content, "utf8");
  }

  writeFileSync(
    path.join(root, "planos", "README.md"),
    "# Planos\n\nColoca aqui los planos en PDF o imagen que se referencien desde los anexos.\n",
    "utf8"
  );
}

function projectConfig(template: string): string {
  return `main = "main.kui"\ntemplate = "${template}"\nbuildDir = "build"\n`;
}

function sampleKref(): string {
  return `garcia2020:\n  type: article\n  title: Wari en Cusco\n  author:\n    - Ana García\n  year: 2020\n  journal: Revista Andina\n\nlopez2021:\n  type: book\n  title: Metodología arqueológica andina\n  author:\n    - Marco López\n  year: 2021\n  publisher: Fondo Editorial Andino\n`;
}

function sampleDocument(template: string): string {
  return `---\ntitle: "Documento KUI de ejemplo"\nauthor: "Daril Yovani Cabrera"\ndate: 2026\nlanguage: es\ntemplate: ${template}\nrefs: ./referencias.kref\ncsl: apa.csl\n---\n\n:::resumen\nEste documento demuestra la sintaxis KUI mínima para un trabajo académico.\n:::\n\n:indice\n\n# Introducción {#sec:intro}\nSegún @garcia2020, KUI permite escribir documentos académicos con menos fricción.\n\nVer la ecuación @eq:rho.\n\n$$\n\\rho = \\frac{n}{V}\n$$ {#eq:rho}\n\n:::nota\nLos bloques de nota se renderizan como callouts.\n:::\n\n:bibliografia\n`;
}

function tesisMainDocument(): string {
  return `---\ntemplate: tesis-unsaac\ntitle: "TÍTULO COMPLETO DE LA TESIS"\nauthor: "Bach. Nombre del Tesista"\ndni: "00000000"\norcid: "0000-0000-0000-0000"\nasesor: "Dr. Nombre del Asesor"\ncoasesor: ""\njurado:\n  - "Presidente del jurado"\n  - "Primer dictaminante"\n  - "Segundo dictaminante"\ninstitucion: "Universidad Nacional de San Antonio Abad del Cusco"\nfacultad: "Nombre de la Facultad"\nschool: "Nombre de la Escuela Profesional"\nacademicDegree: "Licenciado(a) en ..."\ndate: 2026\nlanguage: es\nrefs: ./referencias.kref\ncsl: apa.csl\n---\n\n:incluir contenido/presentacion.kui\n:incluir contenido/dedicatoria.kui\n:incluir contenido/agradecimiento.kui\n\n:indice\n:tablas\n:figuras\n\n:incluir contenido/resumen.kui\n:incluir contenido/abstract.kui\n:incluir contenido/introduccion.kui\n\n:incluir contenido/cap1_planteamiento_del_problema.kui\n:incluir contenido/cap2_marco_teorico.kui\n:incluir contenido/cap3_metodologia.kui\n:incluir contenido/cap4_resultados.kui\n\n:incluir contenido/discusiones.kui\n:incluir contenido/conclusiones.kui\n:incluir contenido/recomendaciones.kui\n\n:bibliografia\n:incluir contenido/anexo.kui\n`;
}

function tesisContentFiles(): Array<{ name: string; content: string }> {
  return [
    {
      name: "presentacion.kui",
      content: `:::presentacion\nSeñor Decano de la Facultad de [NOMBRE DE LA FACULTAD]:\n\nPresento a consideración el trabajo de tesis titulado "[TÍTULO DE LA TESIS]", elaborado para optar al grado académico correspondiente.\n:::\n`
    },
    {
      name: "dedicatoria.kui",
      content: `:::dedicatoria\nDedico este trabajo a mi familia, por su apoyo constante durante mi formación profesional.\n:::\n`
    },
    {
      name: "agradecimiento.kui",
      content: `:::agradecimiento\nAgradezco a mi asesor, docentes y compañeros por sus aportes durante el desarrollo de esta investigación.\n:::\n`
    },
    {
      name: "resumen.kui",
      content: `:::resumen\nEste resumen presenta el problema, objetivo, metodología, resultados principales y conclusiones de la tesis en un máximo aproximado de 300 palabras.\n:::\n`
    },
    {
      name: "abstract.kui",
      content: `:::abstract\nThis abstract presents the research problem, objective, methodology, main results and conclusions of the thesis.\n:::\n`
    },
    {
      name: "introduccion.kui",
      content: `:::introduccion\nLa introducción describe el contexto del estudio, la motivación, el alcance de la investigación y la organización general de la tesis.\n:::\n`
    },
    {
      name: "cap1_planteamiento_del_problema.kui",
      content: `# Planteamiento del problema {.chapter #ch:planteamiento}\n\n## Descripción del problema\n\nDescribe el problema de investigación y el contexto donde ocurre.\n\n## Formulación del problema\n\n- Problema general: ¿Cuál es el problema central de la investigación?\n- Problemas específicos: enumera las preguntas derivadas.\n\n## Justificación\n\nExplica la importancia teórica, práctica, metodológica o social del estudio.\n\n## Objetivos\n\n### Objetivo general\n\nDefine el propósito principal de la tesis.\n\n### Objetivos específicos\n\n- Objetivo específico 1.\n- Objetivo específico 2.\n- Objetivo específico 3.\n`
    },
    {
      name: "cap2_marco_teorico.kui",
      content: `# Marco teórico {.chapter #ch:marco-teorico}\n\n## Antecedentes\n\nSegún @garcia2020, los antecedentes permiten ubicar el problema en una tradición académica concreta.\n\n## Bases teóricas\n\nDesarrolla los conceptos, teorías y modelos que sostienen la investigación.\n\n## Marco conceptual\n\n:::definicion {#def:variable}\nUna variable es una característica observable o medible dentro del estudio.\n:::\n\nVer @def:variable para la definición base usada en la tesis.\n`
    },
    {
      name: "cap3_metodologia.kui",
      content: `# Metodología {.chapter #ch:metodologia}\n\n## Tipo y diseño de investigación\n\nDescribe el enfoque, tipo, nivel y diseño metodológico.\n\n## Población y muestra\n\nDefine la población, muestra y criterios de selección.\n\n## Técnicas e instrumentos\n\n| Técnica | Instrumento | Propósito |\n| :--- | :--- | :--- |\n| Revisión documental | Ficha de análisis | Organizar antecedentes |\n| Encuesta | Cuestionario | Recoger información primaria |\n: Técnicas e instrumentos de recolección {#tbl:tecnicas}\n\nLa tabla @tbl:tecnicas resume los instrumentos previstos.\n`
    },
    {
      name: "cap4_resultados.kui",
      content: `# Resultados {.chapter #ch:resultados}\n\n## Presentación de resultados\n\nExpón los hallazgos principales siguiendo el orden de los objetivos específicos.\n\n## Análisis de resultados\n\nRelaciona los resultados con el marco teórico y los antecedentes revisados.\n`
    },
    {
      name: "discusiones.kui",
      content: `# Discusiones {.chapter #ch:discusiones}\n\nContrasta los resultados obtenidos con la literatura previa y explica sus implicancias académicas.\n`
    },
    {
      name: "conclusiones.kui",
      content: `# Conclusiones {.chapter #ch:conclusiones}\n\n- Conclusión vinculada al objetivo general.\n- Conclusión vinculada al primer objetivo específico.\n- Conclusión vinculada al segundo objetivo específico.\n`
    },
    {
      name: "recomendaciones.kui",
      content: `# Recomendaciones {.chapter #ch:recomendaciones}\n\n- Recomendación institucional.\n- Recomendación metodológica.\n- Recomendación para investigaciones futuras.\n`
    },
    {
      name: "anexo.kui",
      content: `# Anexos {.appendix #ch:anexos}\n\n## Matriz de consistencia\n\nIncluye la matriz de consistencia, instrumentos, evidencias, panel fotográfico o planos.\n\n## Planos\n\nColoca los archivos en la carpeta \`planos/\` y referencia cada recurso cuando corresponda.\n`
    }
  ];
}
