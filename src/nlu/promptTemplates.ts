import type { DiscoveredTool } from "../types/mcp.types.js";

export function buildSystemPrompt(tools: DiscoveredTool[]): string {
  const toolDescriptions = tools.length > 0
    ? tools
        .map(
          (t) =>
            `- Service: ${t.service} | Tool: ${t.tool.name} | Description: ${t.tool.description ?? "N/A"} | Parameters: ${JSON.stringify(t.tool.inputSchema ?? {})}`,
        )
        .join("\n")
    : "No tools discovered yet. Use general intent classification based on the categories below.";

  return `You are an intent parser for a Swiggy food/grocery/dining assistant Telegram bot.

Your job: Given a user message and conversation history, output a JSON object describing the user's intent.

## Available Swiggy MCP Tools
${toolDescriptions}

## Output Schema (STRICT JSON, no markdown, no code blocks):
{
  "intent": "<one of: food_search, food_menu_browse, food_add_to_cart, food_view_cart, food_checkout, grocery_search, grocery_add_to_cart, grocery_checkout, dineout_search, dineout_details, dineout_check_slots, dineout_book_table, general_help, auth_request, unknown>",
  "service": "<food | instamart | dineout | general>",
  "confidence": <0.0 to 1.0>,
  "toolName": "<exact tool name from available tools, or null if no tool match>",
  "parameters": { <key-value pairs matching the tool's inputSchema> },
  "filters": {
    "maxPrice": <number or null>,
    "minRating": <number or null>,
    "maxDeliveryTimeMinutes": <number or null>,
    "dietaryPreferences": [<"veg", "non-veg", "vegan", "egg"> or empty array],
    "cuisine": [<strings> or empty array],
    "sortBy": "<price_asc | price_desc | rating | delivery_time | relevance | null>"
  },
  "followUp": <true if referencing previous context, false otherwise>,
  "originalQuery": "<the user's original message>"
}

## Rules:
1. Extract ALL relevant parameters from the user's natural language.
2. "under 200" or "below 200" or "less than 200" means maxPrice: 200.
3. "in 30 mins" or "delivered in half an hour" means maxDeliveryTimeMinutes: 30.
4. "veg only" or "pure veg" or "vegetarian" means dietaryPreferences: ["veg"].
5. "non-veg" or "chicken" or "mutton" or "fish" implies dietaryPreferences: ["non-veg"].
6. If the user says "show me more" or "next" after a previous search, set followUp: true.
7. If the user modifies a constraint like "make it cheaper" or "under 150 instead", set followUp: true.
8. If the user says "make it vegetarian" or changes dietary preference, set followUp: true with updated filters.
9. For recipe/ingredient queries like "how to make X" or "ingredients for X", use grocery_search with instamart.
10. For ambiguous queries, pick the most likely intent with a lower confidence score.
11. ALWAYS output valid JSON only. No explanations, no markdown, no code blocks.
12. Map the intent to the closest matching tool from the available tools list.
13. If no tool matches, set toolName to null.
14. For queries about groceries, ingredients, recipes, use service "instamart".
15. For queries about restaurants, food delivery, use service "food".
16. For queries about dining out, reservations, table booking, use service "dineout".`;
}

export const FEW_SHOT_EXAMPLES = [
  {
    role: "user" as const,
    content: "I need a burger under 200 and can be delivered under 30 mins",
  },
  {
    role: "model" as const,
    content: JSON.stringify({
      intent: "food_search",
      service: "food",
      confidence: 0.95,
      toolName: null,
      parameters: { query: "burger" },
      filters: {
        maxPrice: 200,
        minRating: null,
        maxDeliveryTimeMinutes: 30,
        dietaryPreferences: [],
        cuisine: [],
        sortBy: "relevance",
      },
      followUp: false,
      originalQuery: "I need a burger under 200 and can be delivered under 30 mins",
    }),
  },
  {
    role: "user" as const,
    content: "I need to make a strawberry shake",
  },
  {
    role: "model" as const,
    content: JSON.stringify({
      intent: "grocery_search",
      service: "instamart",
      confidence: 0.9,
      toolName: null,
      parameters: { query: "strawberry shake ingredients" },
      filters: {
        maxPrice: null,
        minRating: null,
        maxDeliveryTimeMinutes: null,
        dietaryPreferences: [],
        cuisine: [],
        sortBy: "relevance",
      },
      followUp: false,
      originalQuery: "I need to make a strawberry shake",
    }),
  },
  {
    role: "user" as const,
    content: "Find vegetarian pizza under 300",
  },
  {
    role: "model" as const,
    content: JSON.stringify({
      intent: "food_search",
      service: "food",
      confidence: 0.95,
      toolName: null,
      parameters: { query: "pizza" },
      filters: {
        maxPrice: 300,
        minRating: null,
        maxDeliveryTimeMinutes: null,
        dietaryPreferences: ["veg"],
        cuisine: ["Italian"],
        sortBy: "relevance",
      },
      followUp: false,
      originalQuery: "Find vegetarian pizza under 300",
    }),
  },
  {
    role: "user" as const,
    content: "Make it under 150 instead",
  },
  {
    role: "model" as const,
    content: JSON.stringify({
      intent: "food_search",
      service: "food",
      confidence: 0.9,
      toolName: null,
      parameters: { query: "pizza" },
      filters: {
        maxPrice: 150,
        minRating: null,
        maxDeliveryTimeMinutes: null,
        dietaryPreferences: ["veg"],
        cuisine: ["Italian"],
        sortBy: "relevance",
      },
      followUp: true,
      originalQuery: "Make it under 150 instead",
    }),
  },
  {
    role: "user" as const,
    content: "Book a table for 4 at a nice Italian place this Saturday",
  },
  {
    role: "model" as const,
    content: JSON.stringify({
      intent: "dineout_search",
      service: "dineout",
      confidence: 0.9,
      toolName: null,
      parameters: { query: "Italian restaurant", party_size: 4 },
      filters: {
        maxPrice: null,
        minRating: 4.0,
        maxDeliveryTimeMinutes: null,
        dietaryPreferences: [],
        cuisine: ["Italian"],
        sortBy: "rating",
      },
      followUp: false,
      originalQuery: "Book a table for 4 at a nice Italian place this Saturday",
    }),
  },
];
