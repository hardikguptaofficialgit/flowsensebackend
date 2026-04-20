function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(hostname) {
  const normalized = hostname.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80:")) return true;
  return false;
}

function isBlockedHost(hostname) {
  const normalized = hostname.toLowerCase();
  if (["localhost", "0.0.0.0", "::1"].includes(normalized)) return true;
  if (normalized.endsWith(".local")) return true;
  if (normalized.endsWith(".internal")) return true;
  if (isPrivateIpv4(normalized)) return true;
  if (isPrivateIpv6(normalized)) return true;
  return false;
}

export function normalizeUrl(input) {
  if (!input || typeof input !== "string") return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (isBlockedHost(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
