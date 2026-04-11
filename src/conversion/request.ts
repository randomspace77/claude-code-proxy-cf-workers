import { Constants } from "../constants";
import type {
  AppConfig,
  ClaudeMessagesRequest,
  ClaudeMessage,
  ClaudeContentBlock,
  OpenAIRequest,
  OpenAIMessage,
  OpenAIContentPart,
  OpenAIToolCall,
  OpenAITool,
} from "../types";

/**
 * Convert a Claude Messages API request into an OpenAI Chat Completions
 * request. Model mapping is handled by the provider layer before this is called.
 */
export function convertClaudeToOpenAI(
  claudeRequest: ClaudeMessagesRequest,
  config: AppConfig,
): OpenAIRequest {
  const openaiModel = claudeRequest.model;

  const openaiMessages: OpenAIMessage[] = [];

  // System message
  if (claudeRequest.system) {
    const systemText = extractSystemText(claudeRequest.system);
    if (systemText.trim()) {
      openaiMessages.push({
        role: Constants.ROLE_SYSTEM as "system",
        content: systemText.trim(),
      });
    }
  }

  // Process messages
  let i = 0;
  while (i < claudeRequest.messages.length) {
    const msg = claudeRequest.messages[i];

    if (msg.role === Constants.ROLE_USER) {
      openaiMessages.push(convertUserMessage(msg));
    } else if (msg.role === Constants.ROLE_ASSISTANT) {
      openaiMessages.push(convertAssistantMessage(msg));

      // Check if next message contains tool results
      if (i + 1 < claudeRequest.messages.length) {
        const nextMsg = claudeRequest.messages[i + 1];
        if (
          nextMsg.role === Constants.ROLE_USER &&
          Array.isArray(nextMsg.content) &&
          nextMsg.content.some(
            (block) => "type" in block && block.type === Constants.CONTENT_TOOL_RESULT,
          )
        ) {
          i += 1;
          const toolResults = convertToolResults(nextMsg);
          openaiMessages.push(...toolResults);
        }
      }
    }

    i += 1;
  }

  // Build request
  const openaiRequest: OpenAIRequest = {
    model: openaiModel,
    messages: openaiMessages,
    max_tokens: Math.min(
      Math.max(claudeRequest.max_tokens, config.minTokensLimit),
      config.maxTokensLimit,
    ),
    temperature: claudeRequest.temperature,
    stream: claudeRequest.stream ?? false,
  };

  // Optional parameters
  if (claudeRequest.stop_sequences) {
    openaiRequest.stop = claudeRequest.stop_sequences;
  }
  if (claudeRequest.top_p !== undefined && claudeRequest.top_p !== null) {
    openaiRequest.top_p = claudeRequest.top_p;
  }

  // Convert tools
  if (claudeRequest.tools?.length) {
    const openaiTools: OpenAITool[] = [];
    for (const tool of claudeRequest.tools) {
      if (tool.name?.trim()) {
        openaiTools.push({
          type: Constants.TOOL_FUNCTION as "function",
          function: {
            name: tool.name,
            description: tool.description ?? "",
            parameters: tool.input_schema,
          },
        });
      }
    }
    if (openaiTools.length > 0) {
      openaiRequest.tools = openaiTools;
    }
  }

  // Convert tool choice
  if (claudeRequest.tool_choice) {
    const choiceType = claudeRequest.tool_choice.type as string | undefined;
    if (choiceType === "auto" || choiceType === "any") {
      openaiRequest.tool_choice = "auto";
    } else if (choiceType === "tool" && claudeRequest.tool_choice.name) {
      openaiRequest.tool_choice = {
        type: "function",
        function: { name: claudeRequest.tool_choice.name as string },
      };
    } else {
      openaiRequest.tool_choice = "auto";
    }
  }

  return openaiRequest;
}

// ---- Helpers ----

function extractSystemText(
  system: string | Array<{ type: string; text: string }>,
): string {
  if (typeof system === "string") return system;
  return system
    .filter((block) => block.type === Constants.CONTENT_TEXT)
    .map((block) => block.text)
    .join("\n\n");
}

function convertUserMessage(msg: ClaudeMessage): OpenAIMessage {
  if (msg.content === null || msg.content === undefined) {
    return { role: "user", content: "" };
  }

  if (typeof msg.content === "string") {
    return { role: "user", content: msg.content };
  }

  // Multimodal content
  const parts: OpenAIContentPart[] = [];
  for (const block of msg.content) {
    if (block.type === Constants.CONTENT_TEXT) {
      parts.push({
        type: "text",
        text: (block as { type: "text"; text: string }).text,
      });
    } else if (block.type === Constants.CONTENT_IMAGE) {
      const src = (block as { type: "image"; source: Record<string, string> }).source;
      if (src.type === "base64" && src.media_type && src.data) {
        parts.push({
          type: "image_url",
          image_url: {
            url: `data:${src.media_type};base64,${src.data}`,
          },
        });
      }
    }
  }

  if (parts.length === 1 && parts[0].type === "text") {
    return { role: "user", content: parts[0].text! };
  }
  return { role: "user", content: parts };
}

function convertAssistantMessage(msg: ClaudeMessage): OpenAIMessage {
  if (msg.content === null || msg.content === undefined) {
    return { role: "assistant", content: null };
  }

  if (typeof msg.content === "string") {
    return { role: "assistant", content: msg.content };
  }

  const textParts: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];

  for (const block of msg.content) {
    if (block.type === Constants.CONTENT_TEXT) {
      textParts.push((block as { type: "text"; text: string }).text);
    } else if (block.type === Constants.CONTENT_TOOL_USE) {
      const toolBlock = block as {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
      };
      toolCalls.push({
        id: toolBlock.id,
        type: "function",
        function: {
          name: toolBlock.name,
          arguments: JSON.stringify(toolBlock.input),
        },
      });
    }
  }

  const result: OpenAIMessage = {
    role: "assistant",
    content: textParts.length > 0 ? textParts.join("") : null,
  };

  if (toolCalls.length > 0) {
    result.tool_calls = toolCalls;
  }

  return result;
}

function convertToolResults(msg: ClaudeMessage): OpenAIMessage[] {
  const toolMessages: OpenAIMessage[] = [];

  if (!Array.isArray(msg.content)) return toolMessages;

  for (const block of msg.content) {
    if (block.type === Constants.CONTENT_TOOL_RESULT) {
      const toolResult = block as {
        type: "tool_result";
        tool_use_id: string;
        content: unknown;
      };
      toolMessages.push({
        role: "tool",
        tool_call_id: toolResult.tool_use_id,
        content: parseToolResultContent(toolResult.content),
      });
    }
  }

  return toolMessages;
}

function parseToolResultContent(content: unknown): string {
  if (content === null || content === undefined) return "No content provided";
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        if (obj.type === Constants.CONTENT_TEXT && typeof obj.text === "string") {
          parts.push(obj.text);
        } else if (typeof obj.text === "string") {
          parts.push(obj.text);
        } else {
          try {
            parts.push(JSON.stringify(obj));
          } catch {
            parts.push(String(obj));
          }
        }
      }
    }
    return parts.join("\n").trim();
  }

  if (typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (obj.type === Constants.CONTENT_TEXT && typeof obj.text === "string") {
      return obj.text;
    }
    try {
      return JSON.stringify(obj);
    } catch {
      return String(content);
    }
  }

  return String(content);
}
