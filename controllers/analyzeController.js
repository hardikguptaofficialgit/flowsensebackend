import {
  analyzeJourney,
  analyzeTriggeredJourney,
  compareJourneys,
  getRuntimeConfig,
} from "../services/analysisService.js";
import { normalizeUrl } from "../utils/url.js";
import { sendJsonError } from "../utils/http.js";

export async function analyzeUrl(req, res) {
  const normalizedUrl = normalizeUrl(req.body?.url);

  if (!normalizedUrl) {
    sendJsonError(res, 400, "Please enter a valid website URL.");
    return;
  }

  try {
    const result = await analyzeJourney(normalizedUrl);
    res.json(result);
  } catch (error) {
    const details = error instanceof Error ? error.message : "Unknown error";
    const providerFailure = details.includes("provider") || details.includes("AI");
    sendJsonError(
      res,
      providerFailure ? 502 : 500,
      providerFailure ? "AI provider execution failed. Check provider configuration." : "Analysis failed unexpectedly. Please retry."
    );
  }
}

export function configStatus(req, res) {
  const revealDiagnostics = req.query?.debug === "1" && process.env.NODE_ENV !== "production";
  res.json(getRuntimeConfig({ includeDiagnostics: revealDiagnostics }));
}

export async function deploymentHook(req, res) {
  const normalizedUrl = normalizeUrl(req.body?.url);
  if (!normalizedUrl) {
    sendJsonError(res, 400, "Valid url is required in webhook payload.");
    return;
  }

  try {
    const report = await analyzeTriggeredJourney(normalizedUrl, "deployment");
    res.json({ status: "processed", report });
  } catch (error) {
    sendJsonError(res, 500, "Webhook analysis failed.");
  }
}

export async function prMergeHook(req, res) {
  const normalizedUrl = normalizeUrl(req.body?.url);
  if (!normalizedUrl) {
    sendJsonError(res, 400, "Valid url is required in webhook payload.");
    return;
  }

  try {
    const report = await analyzeTriggeredJourney(normalizedUrl, "pr-merge");
    res.json({ status: "processed", report });
  } catch (error) {
    sendJsonError(res, 500, "Webhook analysis failed.");
  }
}

export async function compareUrls(req, res) {
  const left = normalizeUrl(req.body?.leftUrl);
  const right = normalizeUrl(req.body?.rightUrl);

  if (!left || !right) {
    sendJsonError(res, 400, "Both URLs are required for comparison.");
    return;
  }

  try {
    const comparison = await compareJourneys(left, right);
    res.json(comparison);
  } catch (error) {
    sendJsonError(res, 500, "Comparison failed unexpectedly. Please retry.");
  }
}
