import TelegramBot from "node-telegram-bot-api";
import type { AppConfig } from "../config/env.js";
import type { SwiggyService } from "../types/mcp.types.js";
import type { DiscoveredTool } from "../types/mcp.types.js";
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
      this.toolDiscovery,
      this.toolInvoker,
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

      // Discover tools and fetch default address for this newly authenticated service
      try {
        const client = await this.mcpClientManager.getClient(userId, service);
        const tools = await this.toolDiscovery.discoverToolsForUser(userId, service, client);
        await this.autoFetchAddress(userId, service, client, tools);
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
    // Command handlers — all wrapped with .catch() to prevent unhandled rejections from crashing the process
    this.bot.onText(/\/start/, (msg) => {
      this.commandHandlers.handleStart(msg).catch((err) => {
        logger.error("Error in /start handler", { error: String(err) });
      });
    });
    this.bot.onText(/\/help/, (msg) => {
      this.commandHandlers.handleHelp(msg).catch((err) => {
        logger.error("Error in /help handler", { error: String(err) });
      });
    });
    this.bot.onText(/\/login\s*(.*)/, (msg, match) => {
      this.commandHandlers.handleLogin(msg, match?.[1]?.trim()).catch((err) => {
        logger.error("Error in /login handler", { error: String(err) });
      });
    });
    this.bot.onText(/\/logout\s*(.*)/, (msg, match) => {
      this.commandHandlers.handleLogout(msg, match?.[1]?.trim()).catch((err) => {
        logger.error("Error in /logout handler", { error: String(err) });
      });
    });
    this.bot.onText(/\/status/, (msg) => {
      this.commandHandlers.handleStatus(msg).catch((err) => {
        logger.error("Error in /status handler", { error: String(err) });
      });
    });
    this.bot.onText(/\/details/, (msg) => {
      this.commandHandlers.handleDetails(msg).catch((err) => {
        logger.error("Error in /details handler", { error: String(err) });
      });
    });
    this.bot.onText(/\/clear/, (msg) => {
      this.commandHandlers.handleClear(msg).catch((err) => {
        logger.error("Error in /clear handler", { error: String(err) });
      });
    });

    // Callback query handler (inline keyboard buttons)
    this.bot.on("callback_query", (query) => {
      this.handleCallbackQuery(query).catch((err) => {
        logger.error("Error in callback_query handler", { error: String(err) });
      });
    });

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

      // Inject addressId if needed and available
      this.injectAddressId(userId, service, routed.arguments);

      logger.info("Calling MCP tool", {
        userId, service, toolName: routed.toolName,
        arguments: routed.arguments,
        hasAddressId: !!routed.arguments.addressId,
      });

      const toolResult = await this.toolInvoker.invokeWithRetry(
        client,
        service,
        routed.toolName,
        routed.arguments,
      );

      // Handle MCP tool errors gracefully
      if (toolResult.isError) {
        const errorText = toolResult.content
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n");
        logger.warn("Tool returned error, showing user-friendly message", {
          userId, service, toolName: routed.toolName, error: errorText,
        });

        // If addressId is missing, try auto-fetching and retrying once
        if (errorText.includes("addressId")) {
          const retryResult = await this.retryWithAddress(userId, service, client, routed.toolName, routed.arguments);
          if (retryResult && !retryResult.isError) {
            const filtered = this.resultFilter.applyFilters(retryResult, parsedIntent.filters);
            const formatted = this.messageFormatter.formatResults(service, parsedIntent.intent, filtered, parsedIntent.originalQuery);
            const chunks = this.messageFormatter.splitMessage(formatted.text);
            for (let i = 0; i < chunks.length; i++) {
              const isLast = i === chunks.length - 1;
              await this.bot.sendMessage(chatId, chunks[i], {
                parse_mode: formatted.parseMode,
                reply_markup: isLast ? formatted.replyMarkup : undefined,
              });
            }
            this.storeConversationTurn(userId, text, formatted.text.substring(0, 500), parsedIntent, JSON.stringify(filtered.items.slice(0, 3)));
            return;
          }
        }

        // Show the actual error to help the user understand what went wrong
        const userErrorMsg = errorText
          ? `Sorry, that request didn't work.\n\n<b>Error:</b> <i>${this.messageFormatter.escapeHtml(errorText.substring(0, 500))}</i>\n\nTry rephrasing or check /status to verify your connection.`
          : "Sorry, that request didn't work. Please try rephrasing or check /status to verify your connection.";
        await this.bot.sendMessage(chatId, userErrorMsg, { parse_mode: "HTML" });
        this.storeConversationTurn(userId, text, "Tool error: " + errorText.substring(0, 200), parsedIntent);
        return;
      }

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
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error("Pipeline error", { userId, service, error: errMsg, stack: err instanceof Error ? err.stack : undefined });
        await this.bot.sendMessage(
          chatId,
          `Something went wrong.\n\n<b>Details:</b> <i>${this.messageFormatter.escapeHtml(errMsg.substring(0, 300))}</i>`,
          { parse_mode: "HTML" },
        );
      }
    }
  }

  /**
   * After auth, try to find an address-related tool and fetch the user's default address.
   */
  private async autoFetchAddress(
    userId: number,
    service: SwiggyService,
    client: import("@modelcontextprotocol/sdk/client/index.js").Client,
    tools: DiscoveredTool[],
  ): Promise<void> {
    // Already have an address cached
    if (this.sessionStore.getAddressId(userId, service)) return;

    const addressTool = tools.find((t) => {
      const name = t.tool.name.toLowerCase();
      const desc = (t.tool.description ?? "").toLowerCase();
      return name.includes("address") || name.includes("location") ||
        desc.includes("address") || desc.includes("saved location");
    });

    if (!addressTool) {
      logger.debug("No address tool found for service", { userId, service });
      return;
    }

    try {
      const result = await this.toolInvoker.invoke(client, service, addressTool.tool.name, {});
      const text = result.content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");

      logger.info("Address tool response", { userId, service, isError: result.isError, text: text.substring(0, 500) });

      if (result.isError) {
        logger.warn("Address tool returned error", { userId, service, error: text });
        return;
      }

      const parsed = JSON.parse(text);

      // Handle various Swiggy response shapes
      let addresses: Record<string, unknown>[];
      if (Array.isArray(parsed)) {
        addresses = parsed;
      } else if (typeof parsed === "object" && parsed !== null) {
        addresses =
          (parsed.addresses as Record<string, unknown>[]) ??
          (parsed.data as Record<string, unknown>[]) ??
          (parsed.items as Record<string, unknown>[]) ??
          (parsed.results as Record<string, unknown>[]) ??
          // If it's a single address object with an ID field, wrap it
          (parsed.success === false ? [] : [parsed]);
      } else {
        addresses = [];
      }

      logger.info("Parsed addresses", { userId, service, count: addresses.length, firstAddress: addresses[0] ? JSON.stringify(addresses[0]).substring(0, 300) : "none" });

      if (addresses.length > 0) {
        // Try to extract addressId from first address, checking many possible field names
        const addr = addresses[0];
        const id = this.extractAddressId(addr);
        if (id) {
          this.sessionStore.saveAddressId(userId, service, id);
          logger.info("Auto-fetched addressId", { userId, service, addressId: id });
        } else {
          logger.warn("Could not extract addressId from address object", { userId, service, keys: Object.keys(addr) });
        }
      }
    } catch (err) {
      logger.warn("Auto-fetch address failed", { userId, service, error: String(err) });
    }
  }

  /**
   * Inject addressId into tool arguments if the session has one and it's not already provided.
   */
  private injectAddressId(
    userId: number,
    service: SwiggyService,
    args: Record<string, unknown>,
  ): void {
    if (args.addressId) return;
    const addressId = this.sessionStore.getAddressId(userId, service);
    if (addressId) {
      args.addressId = addressId;
      logger.debug("Injected addressId into tool args", { userId, service, addressId });
    }
  }

  /**
   * Extract an address ID from an address object, checking many possible field names.
   */
  private extractAddressId(addr: Record<string, unknown>): string {
    // Direct ID fields
    for (const key of ["id", "addressId", "address_id", "addressid", "Id", "ID"]) {
      if (addr[key] != null && String(addr[key]) !== "") {
        return String(addr[key]);
      }
    }
    // Nested: addr.address.id, etc.
    if (typeof addr.address === "object" && addr.address !== null) {
      const nested = addr.address as Record<string, unknown>;
      for (const key of ["id", "addressId", "address_id"]) {
        if (nested[key] != null && String(nested[key]) !== "") {
          return String(nested[key]);
        }
      }
    }
    return "";
  }

  /**
   * Try to auto-fetch address and retry a failed tool call.
   */
  private async retryWithAddress(
    userId: number,
    service: SwiggyService,
    client: import("@modelcontextprotocol/sdk/client/index.js").Client,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<import("../types/mcp.types.js").ToolCallResult | null> {
    try {
      // Discover address tools and try to fetch
      const tools = this.toolDiscovery.getToolsForService(service, userId);
      await this.autoFetchAddress(userId, service, client, tools);

      const addressId = this.sessionStore.getAddressId(userId, service);
      if (!addressId) return null;

      args.addressId = addressId;
      return await this.toolInvoker.invokeWithRetry(client, service, toolName, args);
    } catch (err) {
      logger.warn("Retry with address failed", { userId, service, error: String(err) });
      return null;
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
