import { evaluateFrictionSignals } from "./heuristics.js";

function buildImplementationPrompt(issue, url) {
  return [
    "Act as a senior product UX engineer.",
    `Website: ${url}`,
    `Issue: ${issue.title} (${issue.severity})`,
    `Context: ${issue.explanation}`,
    `User impact: ${issue.impact}`,
    "Return: (1) exact UI changes, (2) copy updates, (3) component-level implementation steps, (4) measurable success criteria.",
  ].join("\n");
}

export function buildReport(simulation) {
  const { issues, uxScore, confidenceScore, taskDifficulty, frictionPoints } = evaluateFrictionSignals(
    simulation.profile,
    simulation
  );

  const sorted = [...issues].sort((a, b) => {
    const rank = { Critical: 4, High: 3, Medium: 2, Low: 1 };
    return rank[b.severity] - rank[a.severity];
  });

  const suggestions = sorted.slice(0, 5).map((issue, index) => ({
    id: `suggestion-${index + 1}`,
    priority: index + 1,
    title: issue.title,
    action: issue.suggestion,
    rationale: issue.impact,
  }));

  const normalizedIssues = sorted.map(({ weightedScore, ...issue }) => ({
    ...issue,
    fixPrompt: buildImplementationPrompt(issue, simulation.url),
  }));

  return {
    id: `${Date.now()}-${Math.round(uxScore * 11)}`,
    analyzedAt: new Date().toISOString(),
    url: simulation.url,
    pageTitle: simulation.pageTitle,
    uxScore,
    confidenceScore,
    taskDifficulty,
    screensVisited: simulation.screenCount,
    frictionPoints,
    perceivedLoadScore: Math.round(Math.max(20, 100 - simulation.profile.estimatedLatencyMs / 24)),
    timeToInteractionMs: simulation.profile.estimatedLatencyMs,
    engineMode: simulation.engine,
    issues: normalizedIssues,
    suggestions,
    journey: simulation.timeline,
    summary: {
      strengths: [
        "Core user intent can be inferred quickly from top-level content.",
        "The journey contains at least one visible route to conversion intent.",
      ],
      risks: sorted.slice(0, 3).map((issue) => issue.impact),
    },
  };
}
