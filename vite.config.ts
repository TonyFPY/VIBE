import { createReadStream, statSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

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

export default defineConfig({ plugins: [serveDataset()] });
