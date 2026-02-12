import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { SwiggyService, ToolCallResult } from "../types/mcp.types.js";
import { SwiggyMcpError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export class ToolInvoker {
  /**
   * Invoke an MCP tool with error handling and retry logic.
   */
  async invoke(
    client: Client,
    service: SwiggyService,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult> {
    logger.info("Invoking MCP tool", { service, toolName, args });

    try {
      const result = await client.callTool({ name: toolName, arguments: args });

      const content = (result.content as Array<{
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
      }>) ?? [];

      const isError = result.isError === true;

      if (isError) {
        const errorText = content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        logger.warn("MCP tool returned error", { service, toolName, error: errorText });
      }

      return { service, toolName, content, isError };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isRetryable = message.includes("timeout") ||
        message.includes("ECONNRESET") ||
        message.includes("503");

      throw new SwiggyMcpError(message, service, toolName, isRetryable);
    }
  }

  /**
   * Invoke with one automatic retry for retryable errors.
   */
  async invokeWithRetry(
    client: Client,
    service: SwiggyService,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult> {
    try {
      return await this.invoke(client, service, toolName, args);
    } catch (err) {
      if (err instanceof SwiggyMcpError && err.isRetryable) {
        logger.info("Retrying MCP tool call", { service, toolName });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return this.invoke(client, service, toolName, args);
      }
      throw err;
    }
  }
}
