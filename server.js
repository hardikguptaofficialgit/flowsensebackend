import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeUrl, compareUrls, configStatus, deploymentHook, prMergeHook } from "./routes/analyze.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 8787;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "flowsense-agent", timestamp: new Date().toISOString() });
});

app.get("/api/config", configStatus);
app.post("/api/analyze", analyzeUrl);
app.post("/api/compare", compareUrls);
app.post("/api/hooks/deployment", deploymentHook);
app.post("/api/hooks/pr-merge", prMergeHook);

const distPath = path.resolve(__dirname, "..", "dist");
app.use(express.static(distPath));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) {
    next();
    return;
  }
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`FlowSense backend listening on http://localhost:${PORT}`);
});
