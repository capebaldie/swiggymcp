import type { ParsedIntent, ConversationTurn } from "../types/gemini.types.js";
import type { DiscoveredTool, SwiggyService } from "../types/mcp.types.js";
import { logger } from "../utils/logger.js";

export interface RoutedIntent {
  service: SwiggyService;
  toolName: string;
  arguments: Record<string, unknown>;
  originalIntent: ParsedIntent;
}

// Maps intent categories to likely tool name patterns
const INTENT_TOOL_HINTS: Record<string, string[]> = {
  food_search: ["search", "restaurant", "find", "discover"],
  food_menu_browse: ["menu", "browse", "items", "dishes"],
  food_add_to_cart: ["cart", "add"],
  food_view_cart: ["cart", "view", "get"],
  food_checkout: ["checkout", "order", "place"],
  grocery_search: ["search", "product", "find"],
  grocery_add_to_cart: ["cart", "add"],
  grocery_checkout: ["checkout", "order", "place"],
  dineout_search: ["search", "restaurant", "find", "discover"],
  dineout_details: ["detail", "info", "menu"],
  dineout_check_slots: ["slot", "availability", "check"],
  dineout_book_table: ["book", "reserve", "table"],
};

export class IntentRouter {
  /**
   * Route a parsed intent to a specific MCP tool.
   * If Gemini already provided a toolName, use it.
   * Otherwise, try to match based on intent category and available tools.
   */
  route(intent: ParsedIntent, availableTools: DiscoveredTool[]): RoutedIntent | null {
    const service = this.mapServiceName(intent.service);
    if (!service) {
      logger.warn("Cannot route intent: no valid service", { intent: intent.intent });
      return null;
    }

    // Filter tools for this service
    const serviceTools = availableTools.filter((t) => t.service === service);

    if (serviceTools.length === 0) {
      logger.warn("No tools available for service", { service });
      return null;
    }

    // If Gemini provided a tool name, verify it exists
    if (intent.toolName) {
      const match = serviceTools.find((t) => t.tool.name === intent.toolName);
      if (match) {
        return {
          service,
          toolName: match.tool.name,
          arguments: intent.parameters,
          originalIntent: intent,
        };
      }
      logger.warn("Gemini-provided tool name not found", {
        toolName: intent.toolName,
        available: serviceTools.map((t) => t.tool.name),
      });
    }

    // Try to match by intent category hints
    const hints = INTENT_TOOL_HINTS[intent.intent] ?? [];
    for (const hint of hints) {
      const match = serviceTools.find(
        (t) =>
          t.tool.name.toLowerCase().includes(hint) ||
          (t.tool.description ?? "").toLowerCase().includes(hint),
      );
      if (match) {
        return {
          service,
          toolName: match.tool.name,
          arguments: intent.parameters,
          originalIntent: intent,
        };
      }
    }

    // Fallback: use the first tool for this service (often a search tool)
    const fallback = serviceTools[0];
    logger.info("Using fallback tool", {
      service,
      toolName: fallback.tool.name,
    });

    return {
      service,
      toolName: fallback.tool.name,
      arguments: intent.parameters,
      originalIntent: intent,
    };
  }

  /**
   * Merge a follow-up intent with a previous intent.
   * Carries forward parameters and filters from the previous search,
   * overriding with any new values from the follow-up.
   */
  mergeFollowUp(
    current: ParsedIntent,
    previous: ParsedIntent,
  ): ParsedIntent {
    return {
      ...previous,
      // Override with current values where provided
      intent: current.intent !== "unknown" ? current.intent : previous.intent,
      service: current.service !== "general" ? current.service : previous.service,
      confidence: current.confidence,
      toolName: current.toolName ?? previous.toolName,
      parameters: {
        ...previous.parameters,
        ...current.parameters,
      },
      filters: {
        maxPrice: current.filters.maxPrice ?? previous.filters.maxPrice,
        minRating: current.filters.minRating ?? previous.filters.minRating,
        maxDeliveryTimeMinutes:
          current.filters.maxDeliveryTimeMinutes ?? previous.filters.maxDeliveryTimeMinutes,
        dietaryPreferences:
          current.filters.dietaryPreferences && current.filters.dietaryPreferences.length > 0
            ? current.filters.dietaryPreferences
            : previous.filters.dietaryPreferences,
        cuisine:
          current.filters.cuisine && current.filters.cuisine.length > 0
            ? current.filters.cuisine
            : previous.filters.cuisine,
        sortBy: current.filters.sortBy ?? previous.filters.sortBy,
      },
      followUp: true,
      originalQuery: current.originalQuery,
    };
  }

  private mapServiceName(service: string): SwiggyService | null {
    switch (service) {
      case "food":
        return "food";
      case "instamart":
        return "instamart";
      case "dineout":
        return "dineout";
      default:
        return null;
    }
  }
}
