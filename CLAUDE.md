# CLAUDE.md — Swiggy MCP Telegram Bot

## What This Project Is

A Telegram bot that integrates with Swiggy's MCP (Model Context Protocol) servers. Users
interact via natural language in Telegram; Gemini parses intent; the bot calls the appropriate
Swiggy MCP tool and returns formatted results.

**Three Swiggy MCP services:** food (restaurant search/ordering), instamart (grocery), dineout (table booking).

## Tech Stack

- **Runtime:** Node.js 20+, TypeScript (ES2022, Node16 modules)
- **NLU:** Google Gemini (`@google/genai`) for intent parsing
- **MCP:** `@modelcontextprotocol/sdk` for Swiggy API communication
- **Bot:** `node-telegram-bot-api` with long-polling
- **Build:** `tsc` → `dist/`, dev via `tsx watch`
- **Deploy:** Docker multi-stage build, docker-compose

## Commands

```bash
npm run dev        # Development with hot reload (tsx watch)
npm run build      # TypeScript compile to dist/
npm start          # Run production build
docker compose up --build  # Docker
```

## Architecture & Data Flow

```
User (Telegram) → TelegramBotApp.handleNaturalLanguage()
  → GeminiClient.parseIntent()         # NLU: text → ParsedIntent JSON
  → IntentRouter.route()               # Match intent to MCP tool
  → McpClientManager.getClient()       # Get per-user authenticated MCP client
  → ToolInvoker.invokeWithRetry()      # Call MCP tool
  → ResultFilter.applyFilters()        # Apply price/time/diet filters
  → MessageFormatter.formatResults()   # Format for Telegram HTML
  → bot.sendMessage()                  # Send to user
```

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point, wires everything together |
| `src/bot/telegramBot.ts` | Main orchestration: NL pipeline, callback handling, auth flow |
| `src/bot/commandHandlers.ts` | /start, /login, /logout, /status, /clear, /help |
| `src/bot/messageFormatter.ts` | Formats MCP results into Telegram HTML messages |
| `src/bot/inlineKeyboards.ts` | Inline keyboard button builders |
| `src/mcp/mcpClientManager.ts` | Per-user MCP Client lifecycle (connect, disconnect, auth) |
| `src/mcp/oauthProvider.ts` | OAuthClientProvider impl — bridges Swiggy OAuth with Telegram |
| `src/mcp/toolDiscovery.ts` | Discovers available MCP tools per user+service |
| `src/mcp/toolInvoker.ts` | Calls MCP tools with retry logic |
| `src/nlu/geminiClient.ts` | Gemini API wrapper for intent parsing |
| `src/nlu/intentRouter.ts` | Maps ParsedIntent → MCP tool name + args |
| `src/nlu/promptTemplates.ts` | System prompt + few-shot examples for Gemini |
| `src/filters/resultFilter.ts` | Client-side filtering (price, rating, time, diet, sort) |
| `src/memory/sessionStore.ts` | In-memory user sessions, OAuth tokens, pending flows |
| `src/memory/conversationMemory.ts` | Per-user conversation history with TTL cleanup |
| `src/auth/oauthCallbackServer.ts` | HTTP server receiving OAuth redirects at /callback |
| `src/auth/tokenManager.ts` | Listens for OAuth callbacks, exchanges code → tokens |
| `src/config/env.ts` | Loads and validates env vars into AppConfig |
| `src/config/constants.ts` | MCP endpoints, messages, limits |
| `src/types/` | TypeScript interfaces for all modules |
| `src/utils/errors.ts` | Custom error classes (SwiggyMcpError, AuthenticationRequiredError) |
| `src/utils/logger.ts` | JSON structured logger (debug/info/warn/error) |
| `src/utils/rateLimiter.ts` | Sliding-window per-user rate limiter |

## Authentication Flow

1. User sends `/login food` → Bot creates OAuth state, calls `mcpClientManager.initiateAuth()`
2. MCP SDK triggers OAuth discovery → dynamic client registration → authorization URL
3. Bot sends auth URL to user via Telegram inline button
4. User opens link, logs into Swiggy → redirects to `localhost:3000/callback`
5. `OAuthCallbackServer` receives code+state → emits `authCallback` event
6. `TokenManager` listens, exchanges code for tokens via `auth()` SDK helper
7. Tokens saved to `SessionStore` → bot sends success message → discovers tools

## Session & State (all in-memory)

- `SessionStore`: user sessions (userId → UserSession), OAuth tokens, pending auth flows, client registrations, addressId per service
- `ConversationMemory`: per-user chat turns with TTL cleanup (default 1hr)
- `McpClientManager`: per-user+service MCP Client instances (cached)
- `ToolDiscovery`: per-user tool cache with TTL (1hr)

## Important Patterns

- **Per-user MCP clients:** Each user gets their own authenticated MCP Client per service
- **Tool discovery is dynamic:** Tools are fetched from the MCP server after auth, cached with TTL
- **Gemini sees tool schemas:** The system prompt includes discovered tool names, descriptions, and inputSchemas so Gemini can map intents to tools
- **Filters are client-side:** Gemini extracts filter criteria (price, time, diet), ResultFilter applies them after MCP results come back
- **Telegram HTML mode:** All bot messages use `parse_mode: "HTML"` — must escape `<`, `>`, `&` in user content
- **addressId injection:** After auth, the bot auto-fetches the user's default Swiggy address and injects `addressId` into tool calls that require it

## Environment Variables

See `.env.example`. Required: `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`. Everything else has defaults.

## Known Constraints

- OAuth callback is `localhost` — only works when bot and user's browser are on same machine
- Orders are COD only and cannot be cancelled
- Swiggy states third-party app development is not officially permitted
- All state is in-memory (no persistence across restarts)
