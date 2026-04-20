import { runSimulation } from "./simulator.js";
import { buildReport } from "./reportBuilder.js";
import { orchestrateInsights } from "./orchestrator.js";
import { getLearningProfile, updateLearningProfile } from "./learningStore.js";
import { configuredProviders } from "./aiProviders.js";
import { getBrowserDiagnostics } from "./browserService.js";

export async function analyzeJourney(url) {
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
  };

  report.learning = await updateLearningProfile(report);

  return {
    report,
    execution: {
      engine: simulation.engine,
      stages: simulation.stages,
      timeline: simulation.timeline,
    },
  };
}

export async function analyzeTriggeredJourney(url, source) {
  const result = await analyzeJourney(url);
  return {
    ...result.report,
    triggerSource: source,
  };
}

export async function compareJourneys(leftUrl, rightUrl) {
  const [leftSimulation, rightSimulation] = await Promise.all([
    runSimulation(leftUrl),
    runSimulation(rightUrl),
  ]);

  const leftReport = buildReport(leftSimulation);
  const rightReport = buildReport(rightSimulation);

  const winner = leftReport.uxScore === rightReport.uxScore
    ? "tie"
    : leftReport.uxScore > rightReport.uxScore
      ? "left"
      : "right";

  return {
    left: leftReport,
    right: rightReport,
    winner,
    delta: Math.abs(leftReport.uxScore - rightReport.uxScore),
  };
}

export function getRuntimeConfig(options = {}) {
  const includeDiagnostics = Boolean(options.includeDiagnostics);

  const firebaseWebConfig = {
    apiKey: process.env.FIREBASE_WEB_API_KEY || "",
    authDomain: process.env.FIREBASE_WEB_AUTH_DOMAIN || "",
    projectId: process.env.FIREBASE_WEB_PROJECT_ID || "",
    storageBucket: process.env.FIREBASE_WEB_STORAGE_BUCKET || "",
    messagingSenderId: process.env.FIREBASE_WEB_MESSAGING_SENDER_ID || "",
    appId: process.env.FIREBASE_WEB_APP_ID || "",
  };

  return {
    providers: configuredProviders(),
    firebaseWebConfig,
    ...(includeDiagnostics ? { automation: getBrowserDiagnostics() } : {}),
    continuousHooks: {
      deployment: "/api/hooks/deployment",
      pullRequest: "/api/hooks/pr-merge",
    },
  };
}
