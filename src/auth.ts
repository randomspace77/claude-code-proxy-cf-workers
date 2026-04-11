import type { AppConfig } from "./types";

/**
 * Extract API key from request headers.
 * Checks x-api-key first, then Authorization: Bearer.
 */
export function extractApiKey(headers: Headers): string | null {
  const xApiKey = headers.get("x-api-key");
  if (xApiKey) return xApiKey;

  const authorization = headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice(7);
  }

  return null;
}

/**
 * Validate a client-provided API key against the configured ANTHROPIC_API_KEY.
 * Returns true if validation passes (or is not configured).
 */
export function validateClientApiKey(
  config: AppConfig,
  clientApiKey: string | null,
): boolean {
  if (!config.anthropicApiKey) return true;
  if (!clientApiKey) return false;
  return timingSafeEqual(clientApiKey, config.anthropicApiKey);
}

/**
 * Authenticate the request and return the effective client API key.
 * Returns a string (client key) on success, or a Response (error) on failure.
 */
export function authenticate(
  request: Request,
  config: AppConfig,
): Response | string {
  const clientKey = extractApiKey(request.headers);

  // If ANTHROPIC_API_KEY is configured, validate client key against it
  if (!validateClientApiKey(config, clientKey)) {
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "authentication_error",
          message:
            "Invalid API key. Please provide a valid Anthropic API key.",
        },
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Return the client key (may be null/empty — provider key resolution happens later)
  return clientKey || "";
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Pads shorter string to prevent length-based side-channel leakage.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const paddedA = a.padEnd(maxLen, "\0");
  const paddedB = b.padEnd(maxLen, "\0");
  let result = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    result |= paddedA.charCodeAt(i) ^ paddedB.charCodeAt(i);
  }
  return result === 0;
}
