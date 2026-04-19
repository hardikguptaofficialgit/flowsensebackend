const SEVERITY_WEIGHTS = {
  Low: 4,
  Medium: 8,
  High: 12,
  Critical: 18,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function severityFromScore(score) {
  if (score >= 16) return "Critical";
  if (score >= 11) return "High";
  if (score >= 7) return "Medium";
  return "Low";
}

function createIssue(category, score, explanation, impact, suggestion) {
  const severity = severityFromScore(score);
  const titleMap = {
    navigation_confusion: "Navigation paths are ambiguous",
    flow_inefficiency: "Task flow requires too many steps",
    weak_cta_hierarchy: "Primary CTA hierarchy is unclear",
    perceived_latency: "Perceived responsiveness is slow",
    cognitive_overload: "Interface density creates cognitive load",
    inconsistent_patterns: "UI patterns are inconsistent",
    accessibility_contrast: "Accessibility readability gaps",
    mobile_responsiveness: "Mobile behavior risk detected",
  };

  return {
    id: `${category}-${score}`,
    category,
    title: titleMap[category],
    severity,
    explanation,
    impact,
    suggestion,
    weightedScore: SEVERITY_WEIGHTS[severity],
  };
}

export function evaluateFrictionSignals(profile, journey) {
  const issues = [];
  const { linkCount, buttonCount, headingCount, textDensity, hasStrongCTA, pathDepth } = profile;

  if (linkCount > 45 || (linkCount > 30 && headingCount < 6)) {
    issues.push(createIssue(
      "navigation_confusion",
      12,
      "The homepage presents many possible routes with weak directional grouping.",
      "Users spend effort orienting before progressing, increasing bounce risk.",
      "Group key paths and expose a clear primary route near the top fold."
    ));
  }

  if (journey.screenCount > 4 || pathDepth > 3) {
    issues.push(createIssue(
      "flow_inefficiency",
      11,
      "The simulated goal requires multiple context switches before completion.",
      "Longer flows reduce completion rates for signup and purchase intents.",
      "Collapse non-essential steps and introduce progressive disclosure for optional details."
    ));
  }

  if (!hasStrongCTA || buttonCount < 2) {
    issues.push(createIssue(
      "weak_cta_hierarchy",
      10,
      "Primary action visibility is low relative to supporting UI elements.",
      "Visitors may explore without committing, lowering conversion intent.",
      "Promote one primary CTA with stronger contrast and clear action-oriented copy."
    ));
  }

  if (profile.estimatedLatencyMs > 1200) {
    issues.push(createIssue(
      "perceived_latency",
      9,
      "Interaction feedback appears delayed during high-intent transitions.",
      "Users interpret delay as instability and abandon sensitive steps.",
      "Add immediate visual feedback and skeleton states during network-bound transitions."
    ));
  }

  if (textDensity > 0.74 && headingCount < 8) {
    issues.push(createIssue(
      "cognitive_overload",
      8,
      "Content density is high without enough visual chunking.",
      "Users are likely to skim and miss critical trust or decision cues.",
      "Break dense sections into shorter grouped blocks with clearer hierarchy."
    ));
  }

  if (profile.layoutVariance > 0.65) {
    issues.push(createIssue(
      "inconsistent_patterns",
      8,
      "Interaction conventions vary noticeably between visited screens.",
      "Inconsistent controls increase learning time and interaction errors.",
      "Standardize component patterns for form layout, controls, and navigation behaviors."
    ));
  }

  if (profile.readabilityRisk > 0.55) {
    issues.push(createIssue(
      "accessibility_contrast",
      12,
      "Readability and contrast heuristics indicate potential accessibility non-compliance.",
      "Low readability blocks comprehension and reduces trust for critical tasks.",
      "Increase text contrast, line-height consistency, and minimum body font sizing."
    ));
  }

  if (profile.mobileRisk > 0.5) {
    issues.push(createIssue(
      "mobile_responsiveness",
      11,
      "The flow likely degrades on smaller viewports due to layout compression risk.",
      "Mobile users may encounter hidden controls or truncated decision content.",
      "Prioritize mobile-first spacing and test CTA persistence across breakpoints."
    ));
  }

  const totalPenalty = issues.reduce((sum, item) => sum + item.weightedScore, 0);
  const uxScore = clamp(Math.round(96 - totalPenalty * 0.75), 28, 96);
  const confidenceScore = clamp(profile.dataQuality === "observed" ? 88 : 74, 62, 94);
  const taskDifficulty = clamp(Math.round((100 - uxScore) * 0.85), 18, 91);

  return {
    issues,
    uxScore,
    confidenceScore,
    taskDifficulty,
    frictionPoints: issues.length,
  };
}