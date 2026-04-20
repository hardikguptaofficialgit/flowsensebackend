import { callProvider, configuredProviders } from "./aiProviders.js";

const AGENTS = [
  {
    id: "platform-guide",
    name: "Platform Guide",
    role: "Explains FlowSense capabilities, onboarding, and workspace navigation.",
  },
  {
    id: "ux-analyst",
    name: "UX Analyst",
    role: "Helps interpret UX scores, friction points, and report recommendations.",
  },
  {
    id: "deploy-agent",
    name: "Deployment Agent",
    role: "Advises on deployment hooks, CI checks, and post-release quality scans.",
  },
  {
    id: "profile-coach",
    name: "Profile Coach",
    role: "Guides workspace profile setup for better analysis quality.",
  },
];

function heuristicReply(agentId, message, availableProviders) {
  const providerNames = Object.entries(availableProviders)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name.toUpperCase());

  const normalized = String(message || "").toLowerCase();
  if (agentId === "deploy-agent") {
    return [
      "Deployment checklist:",
      "1. Trigger /api/hooks/deployment after each release.",
      "2. Compare baseline URL vs new URL from Analyze -> Compare.",
      "3. Save each report to build trend history.",
      "4. Gate release when Critical issues appear.",
      providerNames.length
        ? `Active providers: ${providerNames.join(", ")}.`
        : "No AI providers are configured, heuristic mode is active.",
    ].join("\n");
  }

  if (normalized.includes("agent") || normalized.includes("deployed")) {
    return `Available agents: ${AGENTS.map((agent) => agent.name).join(", ")}. Pick any one and continue chatting.`;
  }

  if (normalized.includes("score") || normalized.includes("friction")) {
    return "Interpretation guide: UX score above 80 is strong, 60-79 is moderate risk, below 60 needs immediate design iteration. Prioritize High and Critical friction points first.";
  }

  return "FlowSense can analyze URLs, compare experiences, track history, and generate implementation-ready fixes. Ask about onboarding, reports, providers, or deployment workflow.";
}

function systemPromptForAgent(agent) {
  return `You are ${agent.name}. Role: ${agent.role}. Keep answers concise, practical, and platform-specific to FlowSense.`;
}

export function listAgents() {
  const providers = configuredProviders();
  return {
    agents: AGENTS,
    providers,
  };
}

export async function chatWithAgent({ agentId, message }) {
  const providers = configuredProviders();
  const selectedAgent = AGENTS.find((agent) => agent.id === agentId) || AGENTS[0];
  const chain = ["nvidia", "groq"].filter((provider) => providers[provider]);

  for (const provider of chain) {
    try {
      const response = await callProvider(provider, [
        { role: "system", content: systemPromptForAgent(selectedAgent) },
        { role: "user", content: String(message || "") },
      ]);

      if (response?.content) {
        return {
          provider,
          agentId: selectedAgent.id,
          answer: String(response.content).trim(),
          attemptedProviders: chain,
          fallbackUsed: false,
        };
      }
    } catch {
      // Continue fallback chain.
    }
  }

  return {
    provider: "heuristic",
    agentId: selectedAgent.id,
    answer: heuristicReply(selectedAgent.id, message, providers),
    attemptedProviders: chain,
    fallbackUsed: true,
  };
}
