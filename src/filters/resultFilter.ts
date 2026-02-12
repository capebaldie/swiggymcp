import type { ToolCallResult, FilteredResult } from "../types/mcp.types.js";
import type { ResultFilters } from "../types/gemini.types.js";

export class ResultFilter {
  /**
   * Apply user-specified filters to raw MCP tool results.
   * Attempts to parse JSON from text content; falls back to raw text.
   */
  applyFilters(toolResult: ToolCallResult, filters: ResultFilters): FilteredResult {
    const textContent = toolResult.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");

    // Try to parse as JSON
    let items: Record<string, unknown>[];
    try {
      const parsed = JSON.parse(textContent);
      if (Array.isArray(parsed)) {
        items = parsed;
      } else if (typeof parsed === "object" && parsed !== null) {
        // Common response shapes: { items: [...] }, { restaurants: [...] }, { products: [...] }
        items =
          (parsed.items as Record<string, unknown>[]) ??
          (parsed.restaurants as Record<string, unknown>[]) ??
          (parsed.products as Record<string, unknown>[]) ??
          (parsed.results as Record<string, unknown>[]) ??
          (parsed.data as Record<string, unknown>[]) ??
          [parsed];
      } else {
        items = [{ raw: textContent }];
      }
    } catch {
      // Not JSON — return as-is with the raw text
      return {
        items: [{ raw: textContent }],
        totalBeforeFilter: 1,
        totalAfterFilter: 1,
        filtersApplied: [],
      };
    }

    const totalBefore = items.length;
    const filtersApplied: string[] = [];
    let filtered = [...items];

    // Price filter
    if (filters.maxPrice != null) {
      filtered = filtered.filter((item) => {
        const price = this.extractNumber(item, ["price", "cost", "amount", "costForTwo", "mrp"]);
        return price === null || price <= filters.maxPrice!;
      });
      filtersApplied.push(`Price <= ₹${filters.maxPrice}`);
    }

    // Rating filter
    if (filters.minRating != null) {
      filtered = filtered.filter((item) => {
        const rating = this.extractNumber(item, ["rating", "avgRating", "stars", "avgRatings"]);
        return rating === null || rating >= filters.minRating!;
      });
      filtersApplied.push(`Rating >= ${filters.minRating}`);
    }

    // Delivery time filter
    if (filters.maxDeliveryTimeMinutes != null) {
      filtered = filtered.filter((item) => {
        const time = this.extractNumber(item, ["deliveryTime", "eta", "slaString"]);
        // Also check nested sla object
        const sla = item.sla as Record<string, unknown> | undefined;
        const slaTime = sla ? this.extractNumber(sla, ["deliveryTime", "minDeliveryTime"]) : null;
        const effectiveTime = time ?? slaTime;
        return effectiveTime === null || effectiveTime <= filters.maxDeliveryTimeMinutes!;
      });
      filtersApplied.push(`Delivery <= ${filters.maxDeliveryTimeMinutes} min`);
    }

    // Dietary preferences filter
    if (filters.dietaryPreferences && filters.dietaryPreferences.length > 0) {
      filtered = filtered.filter((item) => {
        const isVeg = item.isVeg ?? item.veg ?? item.vegetarian ?? item.isVegetarian;
        if (isVeg === undefined) return true; // No info, keep it

        if (filters.dietaryPreferences!.includes("veg")) return isVeg === true;
        if (filters.dietaryPreferences!.includes("non-veg")) return isVeg === false;
        return true;
      });
      filtersApplied.push(`Diet: ${filters.dietaryPreferences.join(", ")}`);
    }

    // Sorting
    if (filters.sortBy) {
      filtered.sort((a, b) => {
        switch (filters.sortBy) {
          case "price_asc":
            return (this.extractNumber(a, ["price"]) ?? 0) - (this.extractNumber(b, ["price"]) ?? 0);
          case "price_desc":
            return (this.extractNumber(b, ["price"]) ?? 0) - (this.extractNumber(a, ["price"]) ?? 0);
          case "rating":
            return (this.extractNumber(b, ["rating", "avgRating"]) ?? 0) -
              (this.extractNumber(a, ["rating", "avgRating"]) ?? 0);
          case "delivery_time":
            return (this.extractNumber(a, ["deliveryTime", "eta"]) ?? 0) -
              (this.extractNumber(b, ["deliveryTime", "eta"]) ?? 0);
          default:
            return 0;
        }
      });
    }

    return {
      items: filtered,
      totalBeforeFilter: totalBefore,
      totalAfterFilter: filtered.length,
      filtersApplied,
    };
  }

  private extractNumber(obj: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
      const val = obj[key];
      if (typeof val === "number") return val;
      if (typeof val === "string") {
        const num = parseFloat(val.replace(/[^\d.]/g, ""));
        if (!isNaN(num)) return num;
      }
    }
    return null;
  }
}
