import express from "express";
import cors from "cors";
import apiRouter from "./routes/api.js";
import { refreshBrowserDiagnostics } from "./services/browserService.js";
import { configuredProviders } from "./services/aiProviders.js";

const app = express();
const PORT = Number(process.env.PORT || process.env.BACKEND_PORT) || 5000;

function resolveAllowedOrigins() {
  const fromEnv = String(process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (fromEnv.length) return new Set(fromEnv);

  if (process.env.NODE_ENV !== "production") {
    return new Set([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:4173",
      "http://127.0.0.1:4173",
    ]);
  }

  return new Set();
}

const allowedOrigins = resolveAllowedOrigins();

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("CORS origin is not allowed."));
    },
  })
);

app.use(
  express.json({
    limit: "1mb",
    verify(req, _res, buf) {
      req.rawBody = buf.toString("utf8");
    },
  })
);

app.use("/api", apiRouter);

app.use((_req, res) => {
  res.status(404).json({
    error: "Not found.",
    message: "This backend serves API routes only. Use /api/* endpoints.",
  });
});

app.listen(PORT, () => {
  console.log(`FlowSense backend listening on http://localhost:${PORT}`);
  console.log(`Enabled providers: ${JSON.stringify(configuredProviders())}`);
  refreshBrowserDiagnostics()
    .then((diagnostics) => {
      console.log(`Browser automation: ${JSON.stringify(diagnostics)}`);
    })
    .catch((error) => {
      console.error(`Browser diagnostics failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    });
});
