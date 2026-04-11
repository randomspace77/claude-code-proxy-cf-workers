import { describe, it, expect } from "vitest";
import {
  handleCountTokens,
  handleHealth,
  handleRoot,
} from "../src/handlers";
import { authenticate } from "../src/auth";
import type { AppConfig } from "../src/types";

const defaultConfig: AppConfig = {
  openaiApiKey: "sk-test",
  openaiBaseUrl: "https://api.openai.com/v1",
  bigModel: "gpt-4o",
  middleModel: "gpt-4o",
  smallModel: "gpt-4o-mini",
  maxTokensLimit: 16384,
  minTokensLimit: 4096,
  requestTimeout: 90,
  logLevel: "WARNING",
  customHeaders: {},
  passthroughModels: [],
  enableModelMapping: false,
  defaultProvider: "default",
  routing: {},
  providers: {
    default: {
      name: "default",
      baseUrl: "https://api.openai.com/v1",
      protocol: "openai",
      apiKey: "sk-test",
      timeout: 90,
      headers: {},
    },
  },
};

// ---- handleHealth ----

describe("handleHealth", () => {
  it("returns healthy status with config info", () => {
    const response = handleHealth(defaultConfig);
    expect(response.status).toBe(200);
  });

  it("returns healthy status without operational details", async () => {
    const response = handleHealth(defaultConfig);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe("healthy");
    expect(body).toHaveProperty("timestamp");
    // Should NOT expose operational mode details
    expect(body).not.toHaveProperty("key_mode");
    expect(body).not.toHaveProperty("client_api_key_validation");
  });
});

// ---- handleRoot ----

describe("handleRoot", () => {
  it("returns proxy information", async () => {
    const response = handleRoot();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.message).toBe("Claude-to-OpenAI API Proxy (CF Workers) v1.0.0");
    expect(body.status).toBe("running");
  });

  it("includes endpoints but does not expose config", async () => {
    const response = handleRoot();
    const body = (await response.json()) as Record<string, unknown>;

    // Config should NOT be exposed on the root endpoint
    expect(body).not.toHaveProperty("config");

    const endpoints = body.endpoints as Record<string, unknown>;
    expect(endpoints.messages).toBe("/v1/messages");
    expect(endpoints.count_tokens).toBe("/v1/messages/count_tokens");
    expect(endpoints.health).toBe("/health");
  });
});

// ---- authenticate ----

describe("authenticate", () => {
  it("returns empty string when no ANTHROPIC_API_KEY configured and no client key", () => {
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
    });
    const result = authenticate(request, defaultConfig);
    expect(typeof result).toBe("string");
    expect(result).toBe(""); // no client key, provider key resolved later
  });

  it("returns client key when valid key provided via x-api-key", () => {
    const config = { ...defaultConfig, anthropicApiKey: "sk-ant-test" };
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "sk-ant-test" },
    });
    const result = authenticate(request, config);
    expect(typeof result).toBe("string");
    expect(result).toBe("sk-ant-test"); // returns client key; provider key resolved later
  });

  it("returns client key when valid key provided via Authorization Bearer", () => {
    const config = { ...defaultConfig, anthropicApiKey: "sk-ant-test" };
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { Authorization: "Bearer sk-ant-test" },
    });
    const result = authenticate(request, config);
    expect(typeof result).toBe("string");
    expect(result).toBe("sk-ant-test"); // returns client key; provider key resolved later
  });

  it("returns client key when no ANTHROPIC_API_KEY (passthrough)", () => {
    const config = { ...defaultConfig, openaiApiKey: "" };
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "client-key-123" },
    });
    const result = authenticate(request, config);
    expect(typeof result).toBe("string");
    expect(result).toBe("client-key-123");
  });

  it("returns empty string when no ANTHROPIC_API_KEY and no client key", () => {
    const config = { ...defaultConfig, openaiApiKey: "" };
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
    });
    const result = authenticate(request, config);
    // No ANTHROPIC_API_KEY configured, so auth passes; returns empty string
    expect(typeof result).toBe("string");
    expect(result).toBe("");
  });

  it("returns 401 when ANTHROPIC_API_KEY set but no client key provided", async () => {
    const config = { ...defaultConfig, anthropicApiKey: "sk-ant-test" };
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
    });
    const result = authenticate(request, config);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    const body = (await (result as Response).json()) as Record<string, unknown>;
    expect(body.type).toBe("error");
    const error = body.error as Record<string, unknown>;
    expect(error.type).toBe("authentication_error");
  });

  it("returns 401 when wrong key provided", async () => {
    const config = { ...defaultConfig, anthropicApiKey: "sk-ant-test" };
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "wrong-key" },
    });
    const result = authenticate(request, config);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});

// ---- handleCountTokens ----

describe("handleCountTokens", () => {
  it("counts tokens for simple string message", async () => {
    const request = new Request("http://localhost/v1/messages/count_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "glm-5.1",
        messages: [{ role: "user", content: "Hello world" }],
      }),
    });
    const response = await handleCountTokens(request);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, number>;
    expect(body.input_tokens).toBeGreaterThan(0);
    // "Hello world" = 11 chars => ~2 tokens
    expect(body.input_tokens).toBe(Math.floor(11 / 4));
  });

  it("counts tokens for system message (string)", async () => {
    const request = new Request("http://localhost/v1/messages/count_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "glm-5.1",
        system: "You are a helpful assistant.",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });
    const response = await handleCountTokens(request);
    const body = (await response.json()) as Record<string, number>;
    // "You are a helpful assistant." (28 chars) + "Hi" (2 chars) = 30 chars => 7 tokens
    expect(body.input_tokens).toBe(Math.floor(30 / 4));
  });

  it("counts tokens for system message (array)", async () => {
    const request = new Request("http://localhost/v1/messages/count_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "glm-5.1",
        system: [
          { type: "text", text: "First part." },
          { type: "text", text: "Second part." },
        ],
        messages: [{ role: "user", content: "Hi" }],
      }),
    });
    const response = await handleCountTokens(request);
    const body = (await response.json()) as Record<string, number>;
    // "First part." (11) + "Second part." (12) + "Hi" (2) = 25 chars => 6 tokens
    expect(body.input_tokens).toBe(Math.floor(25 / 4));
  });

  it("counts tokens for array content blocks", async () => {
    const request = new Request("http://localhost/v1/messages/count_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "glm-5.1",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is this?" },
              {
                type: "image",
                source: { type: "base64", media_type: "image/png", data: "abc" },
              },
            ],
          },
        ],
      }),
    });
    const response = await handleCountTokens(request);
    const body = (await response.json()) as Record<string, number>;
    // "What is this?" (14 chars) => 3 tokens (images not counted)
    expect(body.input_tokens).toBe(Math.floor(14 / 4));
  });

  it("handles null content in messages", async () => {
    const request = new Request("http://localhost/v1/messages/count_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "glm-5.1",
        messages: [
          { role: "user", content: null },
          { role: "assistant", content: null },
        ],
      }),
    });
    const response = await handleCountTokens(request);
    const body = (await response.json()) as Record<string, number>;
    // No content => minimum 1 token
    expect(body.input_tokens).toBe(1);
  });

  it("handles empty messages array", async () => {
    const request = new Request("http://localhost/v1/messages/count_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "glm-5.1",
        messages: [],
      }),
    });
    const response = await handleCountTokens(request);
    const body = (await response.json()) as Record<string, number>;
    expect(body.input_tokens).toBe(1); // minimum 1
  });

  it("returns 400 for invalid JSON body", async () => {
    const request = new Request("http://localhost/v1/messages/count_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const response = await handleCountTokens(request);
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.type).toBe("error");
  });
});
