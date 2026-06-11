import { createCompilerUiServer } from "./server.js";

const port = Number(readArg("--port") ?? process.env.KUI_UI_PORT ?? 4321);

createCompilerUiServer(process.cwd()).listen(port, () => {
  console.log(`KUI Compiler UI: http://localhost:${port}`);
});

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
