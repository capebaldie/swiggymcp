import type { ConversationTurn, ParsedIntent } from "../types/gemini.types.js";

export class ConversationMemory {
  private store: Map<number, ConversationTurn[]> = new Map();
  private maxTurnsPerUser: number;
  private ttlMs: number;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(maxTurnsPerUser: number = 50, ttlMs: number = 3600000) {
    this.maxTurnsPerUser = maxTurnsPerUser;
    this.ttlMs = ttlMs;
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 300000);
  }

  addTurn(userId: number, turn: ConversationTurn): void {
    if (!this.store.has(userId)) {
      this.store.set(userId, []);
    }
    const turns = this.store.get(userId)!;
    turns.push(turn);

    if (turns.length > this.maxTurnsPerUser) {
      turns.splice(0, turns.length - this.maxTurnsPerUser);
    }
  }

  getHistory(userId: number, limit: number = 10): ConversationTurn[] {
    const turns = this.store.get(userId) ?? [];
    return turns.slice(-limit);
  }

  getLastIntent(userId: number): ParsedIntent | undefined {
    const turns = this.store.get(userId) ?? [];
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].parsedIntent) return turns[i].parsedIntent;
    }
    return undefined;
  }

  getLastToolResults(userId: number): string | undefined {
    const turns = this.store.get(userId) ?? [];
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].toolResults) return turns[i].toolResults;
    }
    return undefined;
  }

  clearHistory(userId: number): void {
    this.store.delete(userId);
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [userId, turns] of this.store.entries()) {
      if (turns.length === 0) {
        this.store.delete(userId);
        continue;
      }
      const lastTurn = turns[turns.length - 1];
      if (now - lastTurn.timestamp > this.ttlMs) {
        this.store.delete(userId);
      }
    }
  }
}
