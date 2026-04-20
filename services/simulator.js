import { buildStages, scanUrlWithAutomation } from "./browserService.js";

function hashString(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export async function runSimulation(url) {
  const scan = await scanUrlWithAutomation(url);

  const seed = hashString(url);
  const timelineLength = 3 + (seed % 3);
  const timeline = scan.screenCandidates.slice(0, timelineLength).map((screen, index) => ({
    step: index + 1,
    action: index === 0 ? "Homepage discovery" : index === 1 ? "Primary CTA follow-through" : "Task continuation",
    screen,
    intent: index <= 1 ? "Explore value proposition" : index === timelineLength - 1 ? "Attempt conversion" : "Assess trust and clarity",
    signal: index === timelineLength - 1 ? "Completion confidence tested" : "Interaction consistency evaluated",
  }));

  const frictionBaseline = Math.max(3, Math.round((scan.profile.linkCount / 25) + (scan.profile.mobileRisk * 4)));
  const stages = buildStages(url, timelineLength, frictionBaseline);

  return {
    url,
    engine: scan.source,
    pageTitle: scan.pageTitle,
    profile: scan.profile,
    timeline,
    stages,
    screenCount: timelineLength,
  };
}
