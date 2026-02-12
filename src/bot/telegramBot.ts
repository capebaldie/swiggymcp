import TelegramBot from "node-telegram-bot-api";
import type { AppConfig } from "../config/env.js";
import type { SwiggyService } from "../types/mcp.types.js";
import type { ParsedIntent } from "../types/gemini.types.js";
import { SessionStore } from "../memory/sessionStore.js";
import { ConversationMemory } from "../memory/conversationMemory.js";
import { McpClientManager } from "../mcp/mcpClientManager.js";
import { ToolDiscovery } from "../mcp/toolDiscovery.js";
import { ToolInvoker } from "../mcp/toolInvoker.js";
import { GeminiClient } from "../nlu/geminiClient.js";
import { IntentRouter } from "../nlu/intentRouter.js";
import { ResultFilter } from "../filters/resultFilter.js";
import { MessageFormatter } from "../bot/messageFormatter.js";
import { CommandHandlers } from "./commandHandlers.js";
import { RateLimiter } from "../utils/rateLimiter.js";
import { AuthenticationRequiredError } from "../utils/errors.js";
import { MESSAGES, SERVICE_LABELS } from "../config/constants.js";
import { logger } from "../utils/logger.js";

export class TelegramBotApp {
  private bot: TelegramBot;
  private config: AppConfig;
  private sessionStore: SessionStore;
  private conversationMemory: ConversationMemory;
  private mcpClientManager: McpClientManager;
  private toolDiscovery: ToolDiscovery;
  private toolInvoker: ToolInvoker;
  private geminiClient: GeminiClient;
  private intentRouter: IntentRouter;
  private resultFilter: ResultFilter;
  private messageFormatter: MessageFormatter;
  private commandHandlers: CommandHandlers;
  private rateLimiter: RateLimiter;

  constructor(config: AppConfig) {
    this.config = config;

    // Initialize bot
    this.bot = new TelegramBot(config.telegramBotToken, { polling: true });

    // Initialize services
    this.sessionStore = new SessionStore();
    this.conversationMemory = new ConversationMemory(
      config.maxConversationTurns,
      config.conversationTtlMs,
    );

    this.mcpClientManager = new McpClientManager(
      this.sessionStore,
      {
        food: config.swiggyMcpFoodUrl,
        instamart: config.swiggyMcpInstamartUrl,
        dineout: config.swiggyMcpDineoutUrl,
      },
      config.oauthCallbackPort,
      config.oauthCallbackHost,
    );

    this.toolDiscovery = new ToolDiscovery();
    this.toolInvoker = new ToolInvoker();
    this.geminiClient = new GeminiClient(config.geminiApiKey, config.geminiModel);
    this.intentRouter = new IntentRouter();
    this.resultFilter = new ResultFilter();
    this.messageFormatter = new MessageFormatter();
    this.rateLimiter = new RateLimiter(config.rateLimitMaxRequests, config.rateLimitWindowMs);

    this.commandHandlers = new CommandHandlers(
      this.bot,
      this.sessionStore,
      this.conversationMemory,
      this.mcpClientManager,
    );
  }

  getSessionStore(): SessionStore {
    return this.sessionStore;
  }

  getMcpClientManager(): McpClientManager {
    return this.mcpClientManager;
  }

  getToolDiscovery(): ToolDiscovery {
    return this.toolDiscovery;
  }

  async start(): Promise<void> {
    this.registerHandlers();
    logger.info("Telegram bot started with polling");
  }

  async stop(): Promise<void> {
    this.bot.stopPolling();
    this.conversationMemory.destroy();
    logger.info("Telegram bot stopped");
  }

  /**
   * Handle OAuth callback completion — send success/failure message to user.
   */
  async handleAuthComplete(
    userId: number,
    chatId: number,
    service: SwiggyService,
    success: boolean,
    error?: string,
  ): Promise<void> {
    if (success) {
      await this.bot.sendMessage(
        chatId,
        MESSAGES.AUTH_SUCCESS(SERVICE_LABELS[service]),
        { parse_mode: "HTML" },
      );

      // Discover tools for this newly authenticated service
      try {
        const client = await this.mcpClientManager.getClient(userId, service);
        await this.toolDiscovery.discoverToolsForUser(userId, service, client);
      } catch (err) {
        logger.warn("Post-auth tool discovery failed", { userId, service, error: String(err) });
      }
    } else {
      await this.bot.sendMessage(
        chatId,
        `Authentication failed for ${SERVICE_LABELS[service]}. ${error ?? "Please try again."}`,
      );
    }
  }

  private registerHandlers(): void {
    // Command handlers
    this.bot.onText(/\/start/, (msg) => this.commandHandlers.handleStart(msg));
    this.bot.onText(/\/help/, (msg) => this.commandHandlers.handleHelp(msg));
    this.bot.onText(/\/login\s*(.*)/, (msg, match) =>
      this.commandHandlers.handleLogin(msg, match?.[1]?.trim()),
    );
    this.bot.onText(/\/logout\s*(.*)/, (msg, match) =>
      this.commandHandlers.handleLogout(msg, match?.[1]?.trim()),
    );
    this.bot.onText(/\/status/, (msg) => this.commandHandlers.handleStatus(msg));
    this.bot.onText(/\/clear/, (msg) => this.commandHandlers.handleClear(msg));

    // Callback query handler (inline keyboard buttons)
    this.bot.on("callback_query", (query) => this.handleCallbackQuery(query));

    // General message handler (natural language)
    this.bot.on("message", (msg) => {
      // Skip commands
      if (msg.text?.startsWith("/")) return;
      if (!msg.text) return;
      this.handleNaturalLanguage(msg).catch((err) => {
        logger.error("Unhandled error in message handler", { error: String(err) });
      });
    });
  }

  private async handleCallbackQuery(query: TelegramBot.CallbackQuery): Promise<void> {
    const data = query.data;
    if (!data) return;

    await this.bot.answerCallbackQuery(query.id);

    const chatId = query.message?.chat.id;
    const userId = query.from.id;
    if (!chatId) return;

    // Handle login callbacks
    if (data.startsWith("login:")) {
      const service = data.split(":")[1] as SwiggyService;
      await this.commandHandlers.initiateLogin(userId, chatId, service);
      return;
    }

    // Handle checkout confirmations
    if (data.startsWith("checkout:")) {
      const [, service, action] = data.split(":");
      if (action === "cancel") {
        await this.bot.sendMessage(chatId, "Order cancelled.");
      } else {
        await this.bot.sendMessage(chatId, `⚠️ Checkout flow for ${service} — this would place a COD order. Feature requires full MCP tool integration.`);
      }
      return;
    }

    // Handle other callbacks (item selection, pagination, etc.)
    try {
      const parsed = JSON.parse(data);
      await this.bot.sendMessage(
        chatId,
        `Selected: ${parsed.a} on ${parsed.s} (ID: ${parsed.p})\n\nFull interactive flows (add to cart, checkout) require active MCP tool integration.`,
      );
    } catch {
      logger.warn("Unknown callback data", { data });
    }
  }

  /**
   * Main natural language processing pipeline.
   */
  private async handleNaturalLanguage(msg: TelegramBot.Message): Promise<void> {
    const userId = msg.from!.id;
    const chatId = msg.chat.id;
    const text = msg.text!;

    // Ensure session exists
    this.sessionStore.getOrCreateSession(userId, chatId, msg.from?.username);

    // Rate limit check
    if (this.rateLimiter.isLimited(userId)) {
      await this.bot.sendMessage(chatId, MESSAGES.ERROR_RATE_LIMIT);
      return;
    }

    // Show typing indicator
    await this.bot.sendChatAction(chatId, "typing");

    // Step 1: Get conversation history
    const history = this.conversationMemory.getHistory(userId);

    // Step 2: Parse intent via Gemini
    const availableTools = this.toolDiscovery.getTools(userId);
    let parsedIntent = await this.geminiClient.parseIntent(text, history, availableTools);

    if (parsedIntent.intent === "unknown" && parsedIntent.confidence === 0) {
      await this.bot.sendMessage(chatId, MESSAGES.ERROR_REPHRASE);
      return;
    }

    // Step 3: Handle follow-ups
    if (parsedIntent.followUp) {
      const previousIntent = this.conversationMemory.getLastIntent(userId);
      if (previousIntent) {
        parsedIntent = this.intentRouter.mergeFollowUp(parsedIntent, previousIntent);
        logger.info("Merged follow-up intent", { userId, merged: parsedIntent });
      }
    }

    // Step 4: Handle non-tool intents
    if (parsedIntent.intent === "general_help") {
      await this.bot.sendMessage(chatId, MESSAGES.HELP, { parse_mode: "HTML" });
      this.storeConversationTurn(userId, text, MESSAGES.HELP, parsedIntent);
      return;
    }

    if (parsedIntent.intent === "auth_request" || parsedIntent.service === "general") {
      await this.bot.sendMessage(
        chatId,
        "I can help with food orders, grocery shopping, and restaurant reservations on Swiggy.\n\nTry something like:\n- \"Find me a pizza under 300\"\n- \"Order milk and bread\"\n- \"Book a table for 2 tonight\"\n\nUse /login to connect your Swiggy account first.",
      );
      this.storeConversationTurn(userId, text, "Help guidance sent", parsedIntent);
      return;
    }

    // Step 5: Check authentication
    const service = parsedIntent.service as SwiggyService;
    if (!this.sessionStore.isAuthenticated(userId, service)) {
      const authMsg = MESSAGES.AUTH_REQUIRED(SERVICE_LABELS[service]);
      await this.bot.sendMessage(chatId, authMsg, { parse_mode: "HTML" });
      this.storeConversationTurn(userId, text, authMsg, parsedIntent);
      return;
    }

    // Step 6: Route intent to MCP tool
    const routed = this.intentRouter.route(parsedIntent, availableTools);
    if (!routed) {
      // No tool match — try direct query with the first available tool for the service
      await this.bot.sendMessage(
        chatId,
        `I understood you want to ${parsedIntent.intent.replace(/_/g, " ")} on ${SERVICE_LABELS[service]}, but I couldn't match it to an available tool. Try rephrasing your request.`,
      );
      this.storeConversationTurn(userId, text, "No tool match", parsedIntent);
      return;
    }

    // Step 7: Call MCP tool
    try {
      const client = await this.mcpClientManager.getClient(userId, service);

      // Discover tools if not yet done
      if (!this.toolDiscovery.hasToolsForService(service, userId)) {
        await this.toolDiscovery.discoverToolsForUser(userId, service, client);

        // Re-route with newly discovered tools
        const freshTools = this.toolDiscovery.getTools(userId);
        const rerouted = this.intentRouter.route(parsedIntent, freshTools);
        if (rerouted) {
          routed.toolName = rerouted.toolName;
          routed.arguments = rerouted.arguments;
        }
      }

      const toolResult = await this.toolInvoker.invokeWithRetry(
        client,
        service,
        routed.toolName,
        routed.arguments,
      );

      // Step 8: Filter results
      const filtered = this.resultFilter.applyFilters(toolResult, parsedIntent.filters);

      // Step 9: Format for Telegram
      const formatted = this.messageFormatter.formatResults(
        service,
        parsedIntent.intent,
        filtered,
        parsedIntent.originalQuery,
      );

      // Step 10: Send response (handle long messages)
      const chunks = this.messageFormatter.splitMessage(formatted.text);
      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        await this.bot.sendMessage(chatId, chunks[i], {
          parse_mode: formatted.parseMode,
          reply_markup: isLast ? formatted.replyMarkup : undefined,
        });
      }

      // Step 11: Store conversation turn
      this.storeConversationTurn(
        userId,
        text,
        formatted.text.substring(0, 500),
        parsedIntent,
        JSON.stringify(filtered.items.slice(0, 3)),
      );

    } catch (err) {
      if (err instanceof AuthenticationRequiredError) {
        this.mcpClientManager.invalidateClient(userId, service);
        await this.bot.sendMessage(
          chatId,
          MESSAGES.AUTH_EXPIRED(SERVICE_LABELS[service]),
          { parse_mode: "HTML" },
        );
      } else {
        logger.error("Pipeline error", { userId, service, error: String(err) });
        await this.bot.sendMessage(chatId, MESSAGES.ERROR_GENERIC);
      }
    }
  }

  private storeConversationTurn(
    userId: number,
    userMessage: string,
    assistantResponse: string,
    parsedIntent?: ParsedIntent,
    toolResults?: string,
  ): void {
    this.conversationMemory.addTurn(userId, {
      role: "user",
      content: userMessage,
      timestamp: Date.now(),
      parsedIntent,
    });
    this.conversationMemory.addTurn(userId, {
      role: "assistant",
      content: assistantResponse,
      timestamp: Date.now(),
      toolResults,
    });
  }
}
