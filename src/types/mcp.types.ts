import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export type SwiggyService = "food" | "instamart" | "dineout";

export interface DiscoveredTool {
  service: SwiggyService;
  tool: Tool;
}

export interface ToolCache {
  tools: DiscoveredTool[];
  discoveredAt: number;
  ttlMs: number;
}

export interface ToolCallResult {
  service: SwiggyService;
  toolName: string;
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError: boolean;
}

export interface FilteredResult {
  items: Record<string, unknown>[];
  totalBeforeFilter: number;
  totalAfterFilter: number;
  filtersApplied: string[];
}
