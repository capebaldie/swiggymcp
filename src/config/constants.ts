import type { SwiggyService } from "../types/mcp.types.js";

export const SWIGGY_MCP_ENDPOINTS: Record<SwiggyService, string> = {
  food: "https://mcp.swiggy.com/food",
  instamart: "https://mcp.swiggy.com/im",
  dineout: "https://mcp.swiggy.com/dineout",
};

export const SERVICE_LABELS: Record<SwiggyService, string> = {
  food: "Swiggy Food",
  instamart: "Instamart",
  dineout: "Dineout",
};

export const VALID_SERVICES: SwiggyService[] = ["food", "instamart", "dineout"];

export const TOOL_CACHE_TTL_MS = 3600000; // 1 hour

export const OAUTH_FLOW_TIMEOUT_MS = 300000; // 5 minutes

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export const MAX_RESULTS_PER_MESSAGE = 5;

export const MESSAGES = {
  WELCOME: `Welcome to <b>Swiggy MCP Bot</b>!

I can help you search for food, groceries, and restaurant reservations on Swiggy using natural language.

<b>Getting started:</b>
1. Use /login food, /login instamart, or /login dineout to connect your Swiggy account
2. Then just tell me what you need!

<b>Examples:</b>
- "I need a burger under 200 delivered in 30 mins"
- "Find vegetarian pizza under 300"
- "Search ingredients for pasta for 2 people"
- "Book a table for 2 at an Italian restaurant tonight"

Use /help for more commands.`,

  HELP: `<b>Commands:</b>
/start - Welcome message
/login &lt;service&gt; - Connect Swiggy account (food, instamart, dineout)
/logout &lt;service&gt; - Disconnect a service
/status - Check which services are connected
/clear - Clear conversation history
/help - Show this message

<b>Natural language examples:</b>
- "I need a burger under 200"
- "Find veg pizza near me"
- "Order milk, bread, and eggs"
- "Book a table for 4 this Saturday"

<b>Follow-up queries:</b>
After a search, you can refine:
- "Make it vegetarian"
- "Under 150 instead"
- "Show more results"`,

  AUTH_REQUIRED: (service: string) =>
    `You need to connect your Swiggy account for <b>${service}</b> first.\nUse /login ${service} to authenticate.`,

  AUTH_SUCCESS: (service: string) =>
    `Successfully connected to <b>${service}</b>! You can now start searching.`,

  AUTH_EXPIRED: (service: string) =>
    `Your <b>${service}</b> session has expired. Please /login ${service} again.`,

  NO_RESULTS: (query: string, filters: string[]) =>
    `No results found for "<b>${query}</b>"${filters.length ? `\n\nFilters applied: ${filters.join(", ")}` : ""}\n\nTry relaxing your filters or searching for something different.`,

  ERROR_GENERIC: "Something went wrong. Please try again.",
  ERROR_REPHRASE: "I had trouble understanding that. Could you rephrase your request?",
  ERROR_RATE_LIMIT: "You're sending messages too fast. Please wait a moment.",
  ERROR_SERVICE_DOWN: "Swiggy is experiencing issues right now. Please try again later.",
};
