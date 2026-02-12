# Swiggy MCP Telegram Bot

A Telegram bot that integrates with Swiggy's MCP (Model Context Protocol) servers and uses Google Gemini API for natural language understanding. Search for food, groceries, and restaurant reservations using natural language.

## Architecture

```
Telegram User → Bot → Gemini (intent parsing)
    → MCP Client (per-user) → Swiggy MCP Servers
    → Result Filtering → Formatted Telegram Message
```

**Three Swiggy MCP Services:**
- **Food** — Restaurant search, menu browsing, ordering (COD)
- **Instamart** — Grocery/product search, ordering (COD)
- **Dineout** — Restaurant discovery, table booking (free bookings)

## Prerequisites

- Node.js >= 20
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Google Gemini API Key (from [AI Studio](https://aistudio.google.com/apikey))
- Swiggy account (for OAuth authentication)

## Setup

```bash
# Clone and install
git clone <repo-url>
cd swiggymcp
npm install

# Configure environment
cp .env.example .env
# Edit .env with your TELEGRAM_BOT_TOKEN and GEMINI_API_KEY

# Development
npm run dev

# Production build
npm run build
npm start
```

## Docker

```bash
cp .env.example .env
# Edit .env with your values
docker compose up --build
```

## Usage

### Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/login <service>` | Connect Swiggy account (food, instamart, dineout) |
| `/logout <service>` | Disconnect a service |
| `/status` | Check connected services |
| `/clear` | Clear conversation history |
| `/help` | Show help |

### Natural Language Examples

**Food Search:**
- "I need a burger under 200 and can be delivered under 30 mins"
- "Find vegetarian pizza under 300"
- "Show me biryani restaurants with 4+ rating"

**Grocery/Recipe:**
- "I need to make a strawberry shake"
- "Search ingredients for pasta for 2 people"
- "Order milk, bread, and eggs"

**Dineout:**
- "Book a table for 4 at an Italian restaurant tonight"
- "Find restaurants in Koramangala with offers"

**Follow-ups:**
- "Make it vegetarian" (refines previous search)
- "Under 150 instead" (changes price filter)
- "Show more results"

## How Authentication Works

Each user must authenticate their Swiggy account via OAuth:

1. User sends `/login food` (or instamart/dineout)
2. Bot generates an OAuth authorization URL
3. User opens the link in their browser and logs into Swiggy
4. Swiggy redirects to the bot's callback server (`http://localhost:3000/callback`)
5. Bot stores the OAuth tokens for future API calls

**Note:** The `http://localhost` callback only works when the bot and user's browser are on the same machine. For remote deployment, you would need a publicly accessible callback URL whitelisted by Swiggy.

## Project Structure

```
src/
├── index.ts              # Entry point
├── config/
│   ├── env.ts            # Environment variable loading
│   └── constants.ts      # Static constants
├── types/                # TypeScript interfaces
├── bot/
│   ├── telegramBot.ts    # Main orchestration pipeline
│   ├── commandHandlers.ts # /start, /login, /help, etc.
│   ├── messageFormatter.ts # Format results for Telegram
│   └── inlineKeyboards.ts # Interactive button builders
├── mcp/
│   ├── mcpClientManager.ts # Per-user MCP Client lifecycle
│   ├── oauthProvider.ts   # OAuthClientProvider implementation
│   ├── toolDiscovery.ts   # Discover MCP tools
│   └── toolInvoker.ts     # Call MCP tools with retry
├── nlu/
│   ├── geminiClient.ts    # Gemini API wrapper
│   ├── intentRouter.ts    # Route intents to MCP tools
│   └── promptTemplates.ts # System prompts for Gemini
├── memory/
│   ├── conversationMemory.ts # Per-user chat history
│   └── sessionStore.ts    # OAuth tokens + sessions
├── filters/
│   └── resultFilter.ts    # Price/time/diet filtering
├── auth/
│   ├── oauthCallbackServer.ts # OAuth redirect handler
│   └── tokenManager.ts    # Token lifecycle management
└── utils/
    ├── logger.ts          # Structured logging
    ├── errors.ts          # Custom error classes
    └── rateLimiter.ts     # Per-user rate limiting
```

## Important Notes

- **COD Only**: Swiggy MCP orders are Cash on Delivery only
- **No Cancellation**: Orders placed through MCP cannot be cancelled
- **Third-Party Restriction**: Swiggy states third-party app development is not officially permitted. Use at your own discretion.
- **OAuth Limitation**: The `localhost` callback works for local development. Production deployment requires a publicly accessible callback URL.
