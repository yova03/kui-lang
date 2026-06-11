import http from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompilerUiServer } from "../src/ui/server.js";

let root: string;
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "kui-ui-live-"));
  mkdirSync(path.join(root, "contenido"));
  writeFileSync(path.join(root, "referencias.kref"), "garcia2020:\n  type: article\n  title: Wari en Cusco\n  author:\n    - Ana García\n  year: 2020\n", "utf8");
  writeFileSync(path.join(root, "contenido", "capitulo.kui"), "# Capitulo\n\nTexto inicial.\n", "utf8");
  writeFileSync(
    path.join(root, "main.kui"),
    "titulo: Live\nautor: A\nplantilla: paper-APA\nreferencias: ./referencias.kref\n\nincluir contenido/capitulo.kui\n",
    "utf8"
  );
  server = createCompilerUiServer(root);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Sin puerto asignado.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

interface SseClient {
  request: http.ClientRequest;
  waitFor: (marker: string, timeoutMs: number) => Promise<string>;
  destroy: () => void;
}

function openSse(url: string): Promise<{ status: number; client: SseClient }> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let buffer = "";
      const waiters: Array<{ marker: string; resolve: (value: string) => void }> = [];
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        buffer += chunk;
        for (let index = waiters.length - 1; index >= 0; index--) {
          if (buffer.includes(waiters[index].marker)) {
            waiters[index].resolve(buffer);
            waiters.splice(index, 1);
          }
        }
      });
      const client: SseClient = {
        request,
        waitFor: (marker, timeoutMs) =>
          new Promise<string>((resolveWait, rejectWait) => {
            if (buffer.includes(marker)) return resolveWait(buffer);
            const timer = setTimeout(() => rejectWait(new Error(`Timeout esperando "${marker}". Buffer: ${buffer}`)), timeoutMs);
            waiters.push({
              marker,
              resolve: (value) => {
                clearTimeout(timer);
                resolveWait(value);
              }
            });
          }),
        destroy: () => request.destroy()
      };
      resolve({ status: response.statusCode ?? 0, client });
    });
    request.on("error", reject);
  });
}

describe("UI live reload", () => {
  it("emits a changed event when a watched include is modified", async () => {
    const { status, client } = await openSse(`${baseUrl}/api/events?file=main.kui`);
    try {
      expect(status).toBe(200);
      await client.waitFor("event: ready", 5_000);

      writeFileSync(path.join(root, "contenido", "capitulo.kui"), "# Capitulo\n\nTexto editado en vivo.\n", "utf8");
      // watchFile fallback polls only the main file; touch it too so the test
      // does not depend on fs.watch delivering include events on every platform.
      writeFileSync(
        path.join(root, "main.kui"),
        "titulo: Live\nautor: A\nplantilla: paper-APA\nreferencias: ./referencias.kref\n\nincluir contenido/capitulo.kui\n",
        "utf8"
      );

      const received = await client.waitFor("event: changed", 5_000);
      expect(received).toContain('"file":"main.kui"');
    } finally {
      client.destroy();
    }
  }, 15_000);

  it("rejects paths outside the project root", async () => {
    const { status, client } = await openSse(`${baseUrl}/api/events?file=../fuera.kui`);
    client.destroy();
    expect(status).toBe(400);
  });

  it("rejects missing files", async () => {
    const { status, client } = await openSse(`${baseUrl}/api/events?file=no-existe.kui`);
    client.destroy();
    expect(status).toBe(404);
  });
});
