import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { SwiggyService, DiscoveredTool, ToolCache } from "../types/mcp.types.js";
import { TOOL_CACHE_TTL_MS } from "../config/constants.js";
import { logger } from "../utils/logger.js";

export class ToolDiscovery {
  private globalCache: ToolCache | null = null;
  private perUserCache: Map<number, ToolCache> = new Map();

  /**
   * Discover tools for a specific user + service using their authenticated client.
   */
  async discoverToolsForUser(
    userId: number,
    service: SwiggyService,
    client: Client,
  ): Promise<DiscoveredTool[]> {
    try {
      const result = await client.listTools();
      const tools: DiscoveredTool[] = result.tools.map((tool) => ({
        service,
        tool,
      }));

      logger.info("Discovered tools for user", {
        userId,
        service,
        count: tools.length,
        toolNames: tools.map((t) => t.tool.name),
      });

      // Merge into per-user cache
      const existing = this.perUserCache.get(userId);
      const otherServiceTools = existing
        ? existing.tools.filter((t) => t.service !== service)
        : [];

      this.perUserCache.set(userId, {
        tools: [...otherServiceTools, ...tools],
        discoveredAt: Date.now(),
        ttlMs: TOOL_CACHE_TTL_MS,
      });

      return tools;
    } catch (err) {
      logger.error("Tool discovery failed", {
        userId,
        service,
        error: String(err),
      });
      return [];
    }
  }

  /**
   * Get all tools available for a user (from per-user cache, falling back to global).
   */
  getTools(userId?: number): DiscoveredTool[] {
    if (userId) {
      const userCache = this.perUserCache.get(userId);
      if (userCache && Date.now() - userCache.discoveredAt < userCache.ttlMs) {
        return userCache.tools;
      }
    }
    if (this.globalCache && Date.now() - this.globalCache.discoveredAt < this.globalCache.ttlMs) {
      return this.globalCache.tools;
    }
    return [];
  }

  /**
   * Get tools filtered by service.
   */
  getToolsForService(service: SwiggyService, userId?: number): DiscoveredTool[] {
    return this.getTools(userId).filter((t) => t.service === service);
  }

  /**
   * Check if tools have been discovered for a user + service.
   */
  hasToolsForService(service: SwiggyService, userId?: number): boolean {
    return this.getToolsForService(service, userId).length > 0;
  }

  /**
   * Invalidate cache for a user.
   */
  invalidateUser(userId: number): void {
    this.perUserCache.delete(userId);
  }
}
