import { chromium } from "playwright";

function hashString(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function tryPlaywrightScan(url) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12000 });

    const data = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      const links = Array.from(document.querySelectorAll("a[href]"));
      const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
      const headings = Array.from(document.querySelectorAll("h1, h2, h3"));

      const ctaKeywords = ["start", "sign up", "book", "buy", "try", "get started", "request demo"];
      const hasStrongCTA = buttons.concat(links).some((node) => {
        const label = (node.textContent || "").trim().toLowerCase();
        return ctaKeywords.some((keyword) => label.includes(keyword));
      });

      const screenCandidates = links
        .map((link) => link.getAttribute("href") || "")
        .filter(Boolean)
        .slice(0, 8);

      return {
        pageTitle: document.title || "Untitled page",
        linkCount: links.length,
        buttonCount: buttons.length,
        headingCount: headings.length,
        textLength: text.length,
        hasStrongCTA,
        screenCandidates,
      };
    });

    const depth = new URL(url).pathname.split("/").filter(Boolean).length;

    return {
      source: "playwright",
      pageTitle: data.pageTitle,
      profile: {
        linkCount: data.linkCount,
        buttonCount: data.buttonCount,
        headingCount: data.headingCount,
        textDensity: clamp(data.textLength / 9000, 0.2, 1),
        hasStrongCTA: data.hasStrongCTA,
        pathDepth: depth,
        layoutVariance: clamp((data.linkCount + data.buttonCount) / 120, 0.2, 0.9),
        readabilityRisk: clamp((data.textLength > 12000 ? 0.65 : 0.42) + (data.headingCount < 4 ? 0.12 : 0), 0.2, 0.9),
        mobileRisk: clamp((data.linkCount > 40 ? 0.62 : 0.35) + (data.buttonCount < 2 ? 0.18 : 0), 0.1, 0.9),
        estimatedLatencyMs: clamp(700 + data.linkCount * 9 + (data.textLength / 35), 400, 2200),
        dataQuality: "observed",
      },
      screenCandidates: data.screenCandidates,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

function buildFallbackProfile(url) {
  const seed = hashString(url);
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean);

  const linkCount = 18 + (seed % 37);
  const buttonCount = 1 + (seed % 7);
  const headingCount = 2 + (seed % 9);
  const textDensity = clamp(0.35 + ((seed % 57) / 100), 0.25, 0.95);

  return {
    source: "heuristic",
    pageTitle: `${parsed.hostname} experience audit`,
    profile: {
      linkCount,
      buttonCount,
      headingCount,
      textDensity,
      hasStrongCTA: /shop|buy|pricing|signup|register|trial/i.test(url) || seed % 3 !== 0,
      pathDepth: Math.max(segments.length, 1),
      layoutVariance: clamp(0.32 + ((seed % 31) / 100), 0.2, 0.9),
      readabilityRisk: clamp(0.28 + ((seed % 47) / 100), 0.2, 0.9),
      mobileRisk: clamp(0.25 + (((seed >> 2) % 53) / 100), 0.2, 0.9),
      estimatedLatencyMs: clamp(600 + (seed % 1400), 420, 2300),
      dataQuality: "simulated",
    },
    screenCandidates: [
      parsed.origin,
      `${parsed.origin}/features`,
      `${parsed.origin}/pricing`,
      `${parsed.origin}/about`,
      `${parsed.origin}/contact`,
    ],
  };
}

function buildStages(url, screenCount, frictionPoints) {
  const host = new URL(url).hostname;
  return [
    { label: "Launching agent...", detail: "Booting autonomous UX analyst runtime." },
    { label: "Initializing session...", detail: `Preparing interaction context for ${host}.` },
    { label: "Scanning homepage...", detail: "Detecting information hierarchy and first-impression signals." },
    { label: "Identifying primary actions...", detail: "Mapping top CTA candidates and user intents." },
    { label: "Navigating interaction paths...", detail: `Exploring ${screenCount} key screens for conversion journey continuity.` },
    { label: "Evaluating usability signals...", detail: `Correlating ${frictionPoints} friction signals with UX heuristics.` },
    { label: "Synthesizing report...", detail: "Generating prioritized recommendations for the product team." },
  ];
}

export async function runSimulation(url) {
  let scan;

  try {
    scan = await tryPlaywrightScan(url);
  } catch {
    scan = buildFallbackProfile(url);
  }

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