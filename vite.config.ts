import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import app from "./src/integrations/app";

function requestHeadersToWeb(headers: Record<string, string | string[] | undefined>) {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) out.append(key, entry);
      continue;
    }
    if (typeof value === "string") out.set(key, value);
  }
  return out;
}

async function readNodeBody(req: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      {
        name: "hono-api-dev-middleware",
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (!req.url?.startsWith("/api/")) {
              next();
              return;
            }

            try {
              const method = (req.method || "GET").toUpperCase();
              const body =
                method === "GET" || method === "HEAD" ? undefined : await readNodeBody(req);
              const request = new Request(`http://localhost${req.url}`, {
                method,
                headers: requestHeadersToWeb(req.headers),
                body: body && body.length > 0 ? body : undefined,
              });

              const response = await app.fetch(request);
              res.statusCode = response.status;
              response.headers.forEach((value, key) => {
                res.setHeader(key, value);
              });
              const payload = Buffer.from(await response.arrayBuffer());
              res.end(payload);
            } catch (error) {
              res.statusCode = 500;
              res.setHeader("content-type", "application/json");
              res.end(
                JSON.stringify({
                  error: "api_proxy_error",
                  details: error instanceof Error ? error.message : String(error),
                }),
              );
            }
          });
        },
      },
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
