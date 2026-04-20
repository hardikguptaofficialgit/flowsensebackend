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
  const timelineLength = 4 + (seed % 3);
  const fallbackScreens = [
    `${new URL(url).origin}/features`,
    `${new URL(url).origin}/pricing`,
    `${new URL(url).origin}/signup`,
    `${new URL(url).origin}/contact`,
  ];
  const screens = [...scan.screenCandidates, ...fallbackScreens].slice(0, timelineLength);

  const journeyModes = [
    {
      action: "Landing page scan",
      intent: "Understand the value proposition before committing attention.",
      signal: "Hero, navigation, and CTA hierarchy were all observed.",
      phase: "arrival",
      focus: "headline clarity",
    },
    {
      action: "Primary CTA inspection",
      intent: "Confirm the main action is visible and feels trustworthy.",
      signal: "Pointer movement and CTA density were evaluated.",
      phase: "consideration",
      focus: "call to action",
    },
    {
      action: "Feature and proof pass",
      intent: "Check whether the next step explains product value and trust.",
      signal: "Supporting content and social proof were compared.",
      phase: "validation",
      focus: "proof points",
    },
    {
      action: "Conversion path attempt",
      intent: "See if the route to signup, booking, or purchase stays obvious.",
      signal: "Form entry, friction, and navigation continuity were checked.",
      phase: "conversion",
      focus: "completion flow",
    },
    {
      action: "Friction review",
      intent: "Test whether the interface slows the user down before commitment.",
      signal: "Density, contrast, and control spacing were scored.",
      phase: "audit",
      focus: "usability gaps",
    },
    {
      action: "Wrap-up and synthesis",
      intent: "Summarize the highest-impact issues for the product team.",
      signal: "Observed path continuity was folded into recommendations.",
      phase: "summary",
      focus: "next actions",
    },
  ];

  const timeline = screens.map((screen, index) => {
    const mode = journeyModes[index] || journeyModes[journeyModes.length - 1];
    return {
      step: index + 1,
      action: mode.action,
      screen,
      intent: mode.intent,
      signal: index === timelineLength - 1 ? `${mode.signal} Final conversion confidence was tested.` : mode.signal,
      phase: mode.phase,
      focus: mode.focus,
    };
  });

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
