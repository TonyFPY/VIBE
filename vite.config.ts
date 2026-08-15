import { createReadStream, statSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { persistLocalSession } from "./tasks/shared/experiment/local-results";

function serveDataset(): Plugin {
  const root = resolve(import.meta.dirname, "data");
  return {
    name: "serve-local-dataset",
    configureServer(server) {
      server.middlewares.use("/data", (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        const filePath = resolve(root, `.${pathname}`);
        if (!filePath.startsWith(root)) return next();
        try {
          if (!statSync(filePath).isFile()) return next();
          response.setHeader("Content-Type", filePath.endsWith(".csv") ? "text/csv" : filePath.match(/\.jpe?g$/i) ? "image/jpeg" : "image/png");
          createReadStream(filePath).pipe(response);
        } catch {
          next();
        }
      });
    },
  };
}

function serveLocalResults(): Plugin {
  const resultsRoot = resolve(import.meta.dirname, "results");
  return {
    name: "serve-local-results",
    configureServer(server) {
      server.middlewares.use("/api/experiments/sessions", (request, response, next) => {
        if (request.method !== "POST") return next();
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("error", () => {
          response.statusCode = 400;
          response.end("Unable to read request body");
        });
        request.on("end", () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            persistLocalSession(payload, resultsRoot);
            response.statusCode = 201;
            response.end();
          } catch (error) {
            response.statusCode = 400;
            response.end(error instanceof Error ? error.message : "Invalid session payload");
          }
        });
      });
    },
  };
}

export default defineConfig({ plugins: [serveDataset(), serveLocalResults()] });
