import type { AppConfig, ResolvedProvider, ClaudeMessagesRequest } from "../types";
import { sendOpenAIRequest } from "./openai-provider";
import { sendAnthropicRequest } from "./anthropic-provider";

/**
 * Dispatch a Claude-format request to the appropriate provider.
 *
 * @param provider - The resolved provider config
 * @param body - The parsed Claude Messages request
 * @param clientApiKey - Client's API key (for passthrough mode)
 * @param config - Global app config (for token limits, log level, etc.)
 * @returns HTTP Response to send back to the client
 */
export async function dispatchToProvider(
  provider: ResolvedProvider,
  body: ClaudeMessagesRequest,
  clientApiKey: string,
  config: AppConfig,
): Promise<Response> {
  // Resolve effective API key: provider key > client key
  const effectiveApiKey = provider.apiKey || clientApiKey;
  if (!effectiveApiKey) {
    return errorResponse(
      401,
      "API key is required. Provide your API key via x-api-key header or Authorization: Bearer header.",
    );
  }

  if (!provider.apiKey) {
    console.warn({
      _tag: "provider-key-missing",
      provider: provider.name,
      message: `No dedicated API key found. Expected secret: PROVIDER_${provider.name.toUpperCase().replace(/-/g, "_")}_API_KEY. Falling back to client key.`,
    });
  }

  if (provider.protocol === "anthropic") {
    return sendAnthropicRequest(provider, body, effectiveApiKey, config);
  }

  return sendOpenAIRequest(provider, body, effectiveApiKey, config);
}

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      type: "error",
      error: { type: "api_error", message },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}
