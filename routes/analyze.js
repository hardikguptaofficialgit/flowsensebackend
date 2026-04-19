import { runSimulation } from "../services/simulator.js";
import { buildReport } from "../services/reportBuilder.js";
import { orchestrateInsights } from "../services/orchestrator.js";
import { getLearningProfile, updateLearningProfile } from "../services/learningStore.js";
import { configuredProviders } from "../services/aiProviders.js";

function normalizeUrl(input) {
  if (!input || typeof input !== "string") return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function analyzeUrl(req, res) {
  const normalizedUrl = normalizeUrl(req.body?.url);

  if (!normalizedUrl) {
    res.status(400).json({ error: "Please enter a valid website URL." });
    return;
  }

  try {
    const simulation = await runSimulation(normalizedUrl);
    const learningBefore = await getLearningProfile(normalizedUrl);
    const baseReport = buildReport(simulation);
    const ai = await orchestrateInsights(simulation, baseReport.issues, learningBefore);

    const report = {
      ...baseReport,
      aiSummary: ai.executiveSummary,
      aiActions: ai.actions,
      modelConfidence: ai.modelConfidence,
      providerUsed: ai.provider,
      providerTrace: ai.providerTrace,
      learning: learningBefore,
    };
    report.learning = await updateLearningProfile(report);

    res.json({
      report,
      execution: {
        engine: simulation.engine,
        stages: simulation.stages,
        timeline: simulation.timeline,
      },
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : "Unknown error";
    const providerFailure = typeof details === "string" && (details.includes("provider") || details.includes("AI"));
    res.status(providerFailure ? 502 : 500).json({
      error: providerFailure ? "AI provider execution failed. Check provider keys/models." : "Analysis failed unexpectedly. Please retry.",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function configStatus(_req, res) {
  res.json({
    providers: configuredProviders(),
    continuousHooks: {
      deployment: "/api/hooks/deployment",
      pullRequest: "/api/hooks/pr-merge",
    },
  });
}

async function runHook(url, source) {
  const simulation = await runSimulation(url);
  const learningBefore = await getLearningProfile(url);
  const baseReport = buildReport(simulation);
  const ai = await orchestrateInsights(simulation, baseReport.issues, learningBefore);
  const report = {
    ...baseReport,
    aiSummary: ai.executiveSummary,
    aiActions: ai.actions,
    modelConfidence: ai.modelConfidence,
    providerUsed: ai.provider,
    providerTrace: ai.providerTrace,
    learning: learningBefore,
    triggerSource: source,
  };
  report.learning = await updateLearningProfile(report);
  return report;
}

export async function deploymentHook(req, res) {
  const normalizedUrl = normalizeUrl(req.body?.url);
  if (!normalizedUrl) {
    res.status(400).json({ error: "Valid url is required in webhook payload." });
    return;
  }

  try {
    const report = await runHook(normalizedUrl, "deployment");
    res.json({ status: "processed", report });
  } catch (error) {
    res.status(500).json({ error: "Webhook analysis failed.", details: error instanceof Error ? error.message : "Unknown error" });
  }
}

export async function prMergeHook(req, res) {
  const normalizedUrl = normalizeUrl(req.body?.url);
  if (!normalizedUrl) {
    res.status(400).json({ error: "Valid url is required in webhook payload." });
    return;
  }

  try {
    const report = await runHook(normalizedUrl, "pr-merge");
    res.json({ status: "processed", report });
  } catch (error) {
    res.status(500).json({ error: "Webhook analysis failed.", details: error instanceof Error ? error.message : "Unknown error" });
  }
}

export async function compareUrls(req, res) {
  const left = normalizeUrl(req.body?.leftUrl);
  const right = normalizeUrl(req.body?.rightUrl);

  if (!left || !right) {
    res.status(400).json({ error: "Both URLs are required for comparison." });
    return;
  }

  try {
    const [leftSimulation, rightSimulation] = await Promise.all([
      runSimulation(left),
      runSimulation(right),
    ]);

    const leftReport = buildReport(leftSimulation);
    const rightReport = buildReport(rightSimulation);

    const winner = leftReport.uxScore === rightReport.uxScore
      ? "tie"
      : leftReport.uxScore > rightReport.uxScore
        ? "left"
        : "right";

    res.json({
      left: leftReport,
      right: rightReport,
      winner,
      delta: Math.abs(leftReport.uxScore - rightReport.uxScore),
    });
  } catch (error) {
    res.status(500).json({
      error: "Comparison failed unexpectedly. Please retry.",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
