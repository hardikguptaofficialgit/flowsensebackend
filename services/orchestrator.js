import { callProvider, configuredProviders } from "./aiProviders.js";

function trimText(text, maxLength) {
  if (!text) return "";
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function makePrompt(simulation, issues, learning) {
  const context = {
    url: simulation.url,
    pageTitle: simulation.pageTitle,
    engine: simulation.engine,
    screensVisited: simulation.screenCount,
    timeline: simulation.timeline,
    profile: simulation.profile,
    issues: issues.map((issue) => ({
      title: issue.title,
      severity: issue.severity,
      explanation: issue.explanation,
      impact: issue.impact,
    })),
    learning,
  };

  return [
    {
      role: "system",
      content: "Act as a senior UX expert. Return strict JSON with keys: executiveSummary, modelConfidence, actions[]. Each action has title, whyItMatters, implementationPrompt.",
    },
    {
      role: "user",
      content: `Analyze this product flow and produce practical, implementation-ready improvements. Context: ${JSON.stringify(context)}`,
    },
  ];
}

function parseJsonResponse(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return null;

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function orchestrateInsights(simulation, issues, learning) {
  const availability = configuredProviders();
  const chain = ["nvidia", "groq", "openai", "perplexity"].filter((provider) => availability[provider]);

  if (!chain.length) {
    throw new Error("No AI provider configured. Add at least one supported provider API key.");
  }

  const messages = makePrompt(simulation, issues, learning);
  const attempted = [];

  for (const provider of chain) {
    attempted.push(provider);
    try {
      const response = await callProvider(provider, messages);
      if (!response?.content) continue;

      const parsed = parseJsonResponse(response.content);
      if (!parsed) continue;

      const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
      return {
        provider,
        executiveSummary: trimText(parsed.executiveSummary || "", 420),
        modelConfidence: Math.max(48, Math.min(Number(parsed.modelConfidence) || 76, 96)),
        actions: actions.slice(0, 6).map((action, index) => ({
          title: trimText(action.title || `Priority action ${index + 1}`, 120),
          whyItMatters: trimText(action.whyItMatters || "Improves conversion and decision clarity.", 250),
          implementationPrompt: trimText(action.implementationPrompt || "Provide concrete implementation guidance.", 600),
        })),
        providerTrace: { attempted, used: provider },
      };
    } catch {
      continue;
    }
  }

  throw new Error(`All configured AI providers failed. Attempted: ${attempted.join(", ")}`);
}
