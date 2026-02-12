import { GoogleGenAI } from "@google/genai";
import type { ParsedIntent, ConversationTurn } from "../types/gemini.types.js";
import type { DiscoveredTool } from "../types/mcp.types.js";
import { buildSystemPrompt, FEW_SHOT_EXAMPLES } from "./promptTemplates.js";
import { logger } from "../utils/logger.js";

export class GeminiClient {
  private ai: GoogleGenAI;
  private modelId: string;

  constructor(apiKey: string, modelId: string = "gemini-2.5-flash") {
    this.ai = new GoogleGenAI({ apiKey });
    this.modelId = modelId;
  }

  async parseIntent(
    userMessage: string,
    conversationHistory: ConversationTurn[],
    availableTools: DiscoveredTool[],
  ): Promise<ParsedIntent> {
    const systemPrompt = buildSystemPrompt(availableTools);

    // Build conversation context from memory
    const historyContents = conversationHistory
      .slice(-10)
      .map((turn) => ({
        role: turn.role === "user" ? ("user" as const) : ("model" as const),
        parts: [{ text: turn.content }],
      }));

    // Build few-shot examples
    const fewShotContents = FEW_SHOT_EXAMPLES.map((ex) => ({
      role: ex.role,
      parts: [{ text: ex.content }],
    }));

    try {
      const response = await this.ai.models.generateContent({
        model: this.modelId,
        contents: [
          ...fewShotContents,
          ...historyContents,
          { role: "user", parts: [{ text: userMessage }] },
        ],
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      });

      const text = response.text ?? "";
      logger.debug("Gemini response", { text });

      const parsed: ParsedIntent = JSON.parse(text);

      // Validate required fields
      if (!parsed.intent || !parsed.service) {
        throw new Error("Missing required fields");
      }

      // Ensure filters object exists with defaults
      parsed.filters = {
        maxPrice: parsed.filters?.maxPrice ?? undefined,
        minRating: parsed.filters?.minRating ?? undefined,
        maxDeliveryTimeMinutes: parsed.filters?.maxDeliveryTimeMinutes ?? undefined,
        dietaryPreferences: parsed.filters?.dietaryPreferences ?? [],
        cuisine: parsed.filters?.cuisine ?? [],
        sortBy: parsed.filters?.sortBy ?? undefined,
      };

      parsed.followUp = parsed.followUp ?? false;
      parsed.originalQuery = parsed.originalQuery ?? userMessage;

      return parsed;
    } catch (err) {
      logger.error("Gemini intent parsing failed", {
        error: String(err),
        userMessage,
      });

      // Return fallback unknown intent
      return {
        intent: "unknown",
        service: "general",
        confidence: 0,
        toolName: null,
        parameters: {},
        filters: {
          dietaryPreferences: [],
          cuisine: [],
        },
        followUp: false,
        originalQuery: userMessage,
      };
    }
  }
}
