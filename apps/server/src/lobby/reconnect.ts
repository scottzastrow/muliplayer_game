import { HttpError } from "../errors.js";

export const RECONNECT_WINDOW_MS = 60_000;
interface Participation {
  connection?: symbol;
  deadline?: number;
  admitted: boolean;
  expired: boolean;
}

export class ReconnectRegistry {
  readonly #sessions = new Map<string, Map<string, Participation>>();
  readonly #emptySince = new Map<string, number>();
  constructor(readonly clock: () => number = Date.now) {}

  start(sessionId: string, accountIds: readonly string[]): void {
    if (this.#sessions.has(sessionId)) throw new Error("Reconnect roster already initialized.");
    this.#sessions.set(sessionId, new Map(accountIds.map(id => [id, {
      admitted: true, expired: false, deadline: this.clock() + RECONNECT_WINDOW_MS
    }])));
    this.#emptySince.set(sessionId, this.clock());
  }
  eligible(sessionId: string, accountId: string): boolean {
    const member = this.#sessions.get(sessionId)?.get(accountId);
    return Boolean(member && !member.expired &&
      (member.connection || (member.deadline !== undefined && this.clock() < member.deadline)));
  }
  connected(sessionId: string, accountId: string): boolean {
    return Boolean(this.#sessions.get(sessionId)?.get(accountId)?.connection);
  }
  canUpgrade(sessionId: string, accountId: string): boolean {
    return this.eligible(sessionId, accountId) &&
      Boolean(this.#sessions.get(sessionId)?.get(accountId)?.admitted);
  }
  rejoin(sessionId: string, accountId: string): void {
    if (!this.eligible(sessionId, accountId)) {
      throw new HttpError(409, "REJOIN_EXPIRED", "This account has no active reconnect reservation.");
    }
    this.#sessions.get(sessionId)!.get(accountId)!.admitted = true;
  }
  attach(sessionId: string, accountId: string): symbol {
    if (!this.canUpgrade(sessionId, accountId)) {
      throw new HttpError(403, "FORBIDDEN", "Rejoin admission is required for this account.");
    }
    const member = this.#sessions.get(sessionId)!.get(accountId)!;
    const token = Symbol("player connection");
    member.connection = token;
    delete member.deadline;
    this.#emptySince.delete(sessionId);
    return token;
  }
  detach(sessionId: string, accountId: string, token: symbol): boolean {
    const member = this.#sessions.get(sessionId)?.get(accountId);
    if (!member || member.connection !== token) return false;
    delete member.connection;
    member.admitted = false;
    member.deadline = this.clock() + RECONNECT_WINDOW_MS;
    this.#trackEmpty(sessionId);
    return true;
  }
  forfeit(sessionId: string, accountId: string): void {
    const member = this.#sessions.get(sessionId)?.get(accountId);
    if (!member) return;
    member.expired = true;
    member.admitted = false;
    delete member.connection;
    delete member.deadline;
    this.#trackEmpty(sessionId);
  }
  expire(sessionId: string): string[] {
    const expired: string[] = [];
    for (const [id, member] of this.#sessions.get(sessionId) ?? []) {
      if (!member.expired && !member.connection && member.deadline !== undefined &&
        this.clock() >= member.deadline) {
        this.forfeit(sessionId, id);
        expired.push(id);
      }
    }
    return expired;
  }
  abandoned(sessionId: string): boolean {
    const since = this.#emptySince.get(sessionId);
    return since !== undefined && this.clock() - since >= RECONNECT_WINDOW_MS;
  }
  release(sessionId: string): void {
    this.#sessions.delete(sessionId);
    this.#emptySince.delete(sessionId);
  }
  #trackEmpty(sessionId: string): void {
    if (![...(this.#sessions.get(sessionId)?.values() ?? [])].some(member => member.connection) &&
      !this.#emptySince.has(sessionId)) this.#emptySince.set(sessionId, this.clock());
  }
}
