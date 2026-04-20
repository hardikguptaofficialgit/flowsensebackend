import { chromium } from "playwright";

let cachedDiagnostics = {
  checkedAt: null,
  playwright: { installed: true, available: false, error: "Not checked yet." },
  puppeteer: { installed: false, available: false, error: "Not checked yet." },
};

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

function toErrorMessage(error) {
  return error instanceof Error ? error.message : "Unknown browser error";
}

async function getPuppeteerModule() {
  try {
    return await import("puppeteer");
  } catch {
    return null;
  }
}

async function collectPageMetrics(page, url) {
  const data = await page.evaluate(() => {
    const text = document.body?.innerText || "";
    const links = Array.from(document.querySelectorAll("a[href]"));
    const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
    const headings = Array.from(document.querySelectorAll("h1, h2, h3"));
    const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
    const images = Array.from(document.querySelectorAll("img[src]"));
    
    // Real mobile responsiveness check
    const hasResponsiveDesign = document.querySelector('meta[name="viewport"]') !== null;
    const mediaQueries = window.matchMedia('(max-width: 768px)').matches;
    const computedStyles = window.getComputedStyle(document.documentElement);

    const ctaKeywords = ["start", "sign up", "book", "buy", "try", "get started", "request demo", "contact", "join", "subscribe"];
    const hasStrongCTA = buttons.concat(links).some((node) => {
      const label = (node.textContent || "").trim().toLowerCase();
      return ctaKeywords.some((keyword) => label.includes(keyword));
    });

    const screenCandidates = links
      .map((link) => link.getAttribute("href") || "")
      .filter(href => !href.startsWith("#") && href.length > 0)
      .slice(0, 8);

    return {
      pageTitle: document.title || "Untitled page",
      linkCount: links.length,
      buttonCount: buttons.length,
      headingCount: headings.length,
      textLength: text.length,
      inputCount: inputs.length,
      imageCount: images.length,
      hasStrongCTA,
      hasResponsiveDesign,
      mediaQueriesActive: mediaQueries,
      screenCandidates,
    };
  });

  const depth = new URL(url).pathname.split("/").filter(Boolean).length;

  return {
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
}

async function scanWithPlaywright(url) {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });
  try {
    // Desktop scan
    const desktopPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await desktopPage.goto(url, { waitUntil: "domcontentloaded", timeout: 12000 });
    const desktopMetrics = await collectPageMetrics(desktopPage, url);
    await desktopPage.close();
    
    // Mobile scan
    const mobilePage = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await mobilePage.goto(url, { waitUntil: "domcontentloaded", timeout: 12000 });
    const mobileMetrics = await collectPageMetrics(mobilePage, url);
    await mobilePage.close();
    
    // Calculate mobile responsiveness score
    const mobileResponsiveScore = (mobileMetrics.hasResponsiveDesign && desktopMetrics.linkCount < 50) ? 0.85 : 0.65;
    
    return { 
      source: "playwright", 
      ...desktopMetrics,
      mobileResponsiveScore,
      scannedAt: new Date().toISOString(),
      dataQuality: "live"
    };
  } catch (error) {
    throw new Error(`Playwright scan failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await browser.close();
  }
}

async function scanWithPuppeteer(url) {
  const puppeteer = await getPuppeteerModule();
  if (!puppeteer) {
    throw new Error("Puppeteer is not installed.");
  }

  const browser = await puppeteer.default.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12000 });
    const metrics = await collectPageMetrics(page, url);
    return { source: "puppeteer", ...metrics };
  } finally {
    await browser.close();
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

export function buildStages(url, screenCount, frictionPoints) {
  const host = new URL(url).hostname;
  return [
    { label: "Launching browser...", detail: "Booting autonomous UX analyst runtime.", kind: "boot", state: "initializing" },
    { label: "Opening session...", detail: `Preparing interaction context for ${host}.`, kind: "setup", state: "hydrating" },
    { label: "Loading homepage...", detail: "Detecting information hierarchy and first-impression signals.", kind: "scan", state: "rendering" },
    { label: "Inspecting primary paths...", detail: "Mapping top CTA candidates and user intents.", kind: "inspect", state: "hovering" },
    { label: "Clicking through key screens...", detail: `Exploring ${screenCount} key screens for conversion journey continuity.`, kind: "navigate", state: "navigating" },
    { label: "Measuring usability friction...", detail: `Correlating ${frictionPoints} friction signals with UX heuristics.`, kind: "evaluate", state: "scoring" },
    { label: "Assembling final report...", detail: "Generating prioritized recommendations for the product team.", kind: "report", state: "done" },
  ];
}

export async function refreshBrowserDiagnostics() {
  const puppeteer = await getPuppeteerModule();
  const playwrightStatus = { installed: true, available: false, error: null };

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent("<title>playwright-probe</title>");
    await browser.close();
    playwrightStatus.available = true;
  } catch (error) {
    playwrightStatus.error = toErrorMessage(error);
  }

  const puppeteerStatus = { installed: Boolean(puppeteer), available: false, error: null };
  if (!puppeteer) {
    puppeteerStatus.error = "Puppeteer is not installed.";
  } else {
    try {
      const browser = await puppeteer.default.launch({ headless: true });
      const page = await browser.newPage();
      await page.setContent("<title>puppeteer-probe</title>");
      await browser.close();
      puppeteerStatus.available = true;
    } catch (error) {
      puppeteerStatus.error = toErrorMessage(error);
    }
  }

  cachedDiagnostics = {
    checkedAt: new Date().toISOString(),
    playwright: playwrightStatus,
    puppeteer: puppeteerStatus,
  };

  return cachedDiagnostics;
}

export function getBrowserDiagnostics() {
  return cachedDiagnostics;
}

export async function scanUrlWithAutomation(url) {
  try {
    console.log(`[SCAN] Starting Playwright automation scan for: ${url}`);
    const result = await scanWithPlaywright(url);
    console.log(`[SCAN] Playwright scan completed successfully for: ${url}`);
    return result;
  } catch (playwrightError) {
    console.warn(`[SCAN] Playwright scan failed for ${url}:`, playwrightError instanceof Error ? playwrightError.message : String(playwrightError));
    
    try {
      console.log(`[SCAN] Attempting fallback with Puppeteer for: ${url}`);
      const result = await scanWithPuppeteer(url);
      console.log(`[SCAN] Puppeteer fallback completed successfully for: ${url}`);
      return result;
    } catch (puppeteerError) {
      console.warn(`[SCAN] Puppeteer fallback failed for ${url}:`, puppeteerError instanceof Error ? puppeteerError.message : String(puppeteerError));
      console.log(`[SCAN] Using heuristic profile for: ${url}`);
      return {
        ...buildFallbackProfile(url),
        automationErrors: {
          playwright: toErrorMessage(playwrightError),
          puppeteer: toErrorMessage(puppeteerError),
        },
        dataQuality: "heuristic",
      };
    }
  }
}
