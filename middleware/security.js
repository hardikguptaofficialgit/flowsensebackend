import crypto from "node:crypto";
import { sendJsonError } from "../utils/http.js";

const buckets = new Map();

function now() {
  return Date.now();
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

export function createRateLimit({ windowMs, max, keyFn }) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("windowMs must be a positive number.");
  }
  if (!Number.isFinite(max) || max <= 0) {
    throw new Error("max must be a positive number.");
  }

  return function rateLimit(req, res, next) {
    const key = keyFn ? keyFn(req) : `${req.path}:${getClientIp(req)}`;
    const current = buckets.get(key);
    const currentTime = now();

    if (!current || current.expiresAt <= currentTime) {
      buckets.set(key, { count: 1, expiresAt: currentTime + windowMs });
      next();
      return;
    }

    current.count += 1;
    if (current.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((current.expiresAt - currentTime) / 1000)));
      sendJsonError(res, 429, "Too many requests. Please try again shortly.");
      return;
    }

    next();
  };
}

function safeEqualHex(leftHex, rightHex) {
  try {
    const left = Buffer.from(leftHex, "hex");
    const right = Buffer.from(rightHex, "hex");
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function verifyWebhookSignature(req, res, next) {
  const secret = String(process.env.WEBHOOK_SECRET || "").trim();
  if (!secret) {
    sendJsonError(res, 503, "Webhook processing is not configured.");
    return;
  }

  const header = String(req.headers["x-flowsense-signature"] || "").trim();
  if (!header.startsWith("sha256=")) {
    sendJsonError(res, 401, "Missing or invalid webhook signature.");
    return;
  }

  const provided = header.slice("sha256=".length);
  const rawBody = req.rawBody || JSON.stringify(req.body || {});
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  if (!safeEqualHex(provided, expected)) {
    sendJsonError(res, 401, "Invalid webhook signature.");
    return;
  }

  next();
}
