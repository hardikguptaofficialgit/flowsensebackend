import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORE_PATH = path.resolve(__dirname, "..", "data", "learning.json");
let writeChain = Promise.resolve();

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

async function writeStore(store) {
  writeChain = writeChain.then(() => fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8"));
  await writeChain;
}

export async function getLearningProfile(url) {
  const host = new URL(url).hostname;
  const store = await readStore();
  const entry = store[host];

  if (!entry) {
    return {
      runCount: 0,
      avgScore: null,
      avgFriction: null,
      trend: "new",
    };
  }

  const trend = entry.runCount < 2
    ? "warming"
    : entry.lastScore >= entry.avgScore
      ? "improving"
      : "declining";

  return {
    runCount: entry.runCount,
    avgScore: Math.round(entry.avgScore),
    avgFriction: Math.round(entry.avgFriction),
    trend,
  };
}

export async function updateLearningProfile(report) {
  const host = new URL(report.url).hostname;
  const store = await readStore();
  const current = store[host] || {
    runCount: 0,
    avgScore: 0,
    avgFriction: 0,
    lastScore: 0,
    lastAnalyzedAt: null,
  };

  const nextCount = current.runCount + 1;
  const avgScore = ((current.avgScore * current.runCount) + report.uxScore) / nextCount;
  const avgFriction = ((current.avgFriction * current.runCount) + report.frictionPoints) / nextCount;

  store[host] = {
    runCount: nextCount,
    avgScore,
    avgFriction,
    lastScore: report.uxScore,
    lastAnalyzedAt: report.analyzedAt,
  };

  await writeStore(store);

  return {
    runCount: nextCount,
    avgScore: Math.round(avgScore),
    avgFriction: Math.round(avgFriction),
    trend: nextCount < 2 ? "warming" : report.uxScore >= avgScore ? "improving" : "declining",
  };
}