import "dotenv/config";

export interface AppConfig {
  telegramBotToken: string;
  geminiApiKey: string;
  geminiModel: string;
  oauthCallbackPort: number;
  oauthCallbackHost: string;
  swiggyMcpFoodUrl: string;
  swiggyMcpInstamartUrl: string;
  swiggyMcpDineoutUrl: string;
  rateLimitMaxRequests: number;
  rateLimitWindowMs: number;
  maxConversationTurns: number;
  conversationTtlMs: number;
  logLevel: string;
  nodeEnv: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export function loadConfig(): AppConfig {
  return {
    telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
    geminiApiKey: required("GEMINI_API_KEY"),
    geminiModel: optional("GEMINI_MODEL", "gemini-2.5-flash"),
    oauthCallbackPort: parseInt(optional("OAUTH_CALLBACK_PORT", "3000"), 10),
    oauthCallbackHost: optional("OAUTH_CALLBACK_HOST", "localhost"),
    swiggyMcpFoodUrl: optional("SWIGGY_MCP_FOOD_URL", "https://mcp.swiggy.com/food"),
    swiggyMcpInstamartUrl: optional("SWIGGY_MCP_INSTAMART_URL", "https://mcp.swiggy.com/im"),
    swiggyMcpDineoutUrl: optional("SWIGGY_MCP_DINEOUT_URL", "https://mcp.swiggy.com/dineout"),
    rateLimitMaxRequests: parseInt(optional("RATE_LIMIT_MAX_REQUESTS", "20"), 10),
    rateLimitWindowMs: parseInt(optional("RATE_LIMIT_WINDOW_MS", "60000"), 10),
    maxConversationTurns: parseInt(optional("MAX_CONVERSATION_TURNS", "50"), 10),
    conversationTtlMs: parseInt(optional("CONVERSATION_TTL_MS", "3600000"), 10),
    logLevel: optional("LOG_LEVEL", "info"),
    nodeEnv: optional("NODE_ENV", "development"),
  };
}
