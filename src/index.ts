import type { Env } from "./types";
import { loadConfig } from "./config";
import { authenticate } from "./auth";
import {
  handleMessages,
  handleCountTokens,
  handleHealth,
  handleRoot,
} from "./handlers";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta, anthropic-dangerous-direct-browser-access",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    try {
      const config = loadConfig(env);
      const url = new URL(request.url);
      const path = url.pathname;

      // Public endpoints (no auth required)
      if (request.method === "GET" && path === "/health") {
        return handleHealth(config);
      }
      if (request.method === "GET" && path === "/") {
        return handleRoot();
      }

      // Auth-protected endpoints
      const authResult = authenticate(request, config);
      if (authResult instanceof Response) return authResult;
      const effectiveApiKey = authResult;

      if (request.method === "POST" && path === "/v1/messages") {
        return handleMessages(request, config, effectiveApiKey);
      }
      if (request.method === "POST" && path === "/v1/messages/count_tokens") {
        return handleCountTokens(request);
      }

      return new Response(
        JSON.stringify({
          type: "error",
          error: { type: "not_found", message: "Not found" },
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      // Don't expose internal error details to the client
      console.error("Unhandled worker error:", err);
      return new Response(
        JSON.stringify({
          type: "error",
          error: { type: "api_error", message: "Internal server error" },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
} satisfies ExportedHandler<Env>;
