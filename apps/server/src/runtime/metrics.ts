import { monitorEventLoopDelay } from "node:perf_hooks";
import type { FastifyInstance } from "fastify";
import type { ModuleMetrics } from "@multiplayer-game/theme-sdk";
import { requireAccount, type AuthContext } from "../auth/routes.js";
import { HttpError } from "../errors.js";

export const TIMING_BUCKETS_MS = [1, 2, 5, 10, 20, 33.3, 50, 100, 250, 1000] as const;
const MAX_SESSIONS = 5;
const MAX_MODULE_METRICS = 32;

export class TimingHistogram {
  readonly #buckets = Array<number>(TIMING_BUCKETS_MS.length + 1).fill(0);
  #count = 0;
  #sum = 0;
  #max = 0;

  observe(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError("Timing must be finite and nonnegative.");
    const index = TIMING_BUCKETS_MS.findIndex((limit) => ms <= limit);
    this.#buckets[index < 0 ? TIMING_BUCKETS_MS.length : index]! += 1;
    this.#count += 1;
    this.#sum += ms;
    this.#max = Math.max(this.#max, ms);
  }

  snapshot() {
    const percentile = (fraction: number): number | null => {
      if (!this.#count) return null;
      let cumulative = 0;
      for (let index = 0; index < this.#buckets.length; index++) {
        cumulative += this.#buckets[index]!;
        if (cumulative >= Math.ceil(this.#count * fraction)) {
          return TIMING_BUCKETS_MS[index] ?? this.#max;
        }
      }
      return this.#max;
    };
    return {
      count: this.#count, sumMs: this.#sum, maxMs: this.#max,
      p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99),
      bucketUpperBoundsMs: [...TIMING_BUCKETS_MS, null], buckets: [...this.#buckets]
    };
  }
}

export interface TransportCounts {
  connections: number;
  players: number;
  spectators: number;
  bufferedBytes: number;
}

function measurements() {
  return {
    simulation: new TimingHistogram(), snapshot: new TimingHistogram(), rtt: new TimingHistogram(),
    bytesIn: 0, bytesOut: 0, bufferHighWaterBytes: 0, errors: 0,
    droppedSnapshots: 0, slowConsumers: 0, disconnects: 0,
    missedDeadlines: 0, droppedTimeMs: 0
  };
}

export class RuntimeMetrics {
  readonly #delay = monitorEventLoopDelay({ resolution: 20 });
  readonly #host = measurements();
  readonly #sessions = new Map<string, ReturnType<typeof measurements> & {
    entities: number; tick: number; missedDeadlines: number; droppedTimeMs: number;
    module: Map<string, number>;
  }>();
  #transport: (sessionId?: string) => TransportCounts = () => ({
    connections: 0, players: 0, spectators: 0, bufferedBytes: 0
  });
  #closed = false;

  constructor() { this.#delay.enable(); }

  setTransport(provider: (sessionId?: string) => TransportCounts): void { this.#transport = provider; }

  startSession(id: string): void {
    if (this.#sessions.has(id)) throw new Error("Metrics session already exists.");
    if (this.#sessions.size >= MAX_SESSIONS) throw new RangeError("Metrics session limit exceeded.");
    this.#sessions.set(id, {
      ...measurements(), entities: 0, tick: 0, missedDeadlines: 0, droppedTimeMs: 0, module: new Map()
    });
  }

  releaseSession(id: string): void { this.#sessions.delete(id); }

  moduleMetrics(id: string): ModuleMetrics {
    const record = (name: string, value: number, increment: boolean): void => {
      const session = this.#sessions.get(id);
      if (!session) throw new Error("Module metrics session is unavailable.");
      if (!/^[a-z][a-z0-9_.]{0,63}$/.test(name) || !Number.isFinite(value)) {
        throw new TypeError("Invalid module metric name or value.");
      }
      if (!session.module.has(name) && session.module.size >= MAX_MODULE_METRICS) {
        throw new RangeError("Module metric limit exceeded.");
      }
      const next = increment ? (session.module.get(name) ?? 0) + value : value;
      if (!Number.isFinite(next)) throw new RangeError("Module metric overflow.");
      session.module.set(name, next);
    };
    return {
      increment: (name, amount = 1) => record(name, amount, true),
      gauge: (name, value) => record(name, value, false)
    };
  }

  timing(id: string, kind: "simulation" | "snapshot" | "rtt", ms: number): void {
    this.#host[kind].observe(ms);
    this.#sessions.get(id)?.[kind].observe(ms);
  }

  event(id: string, kind: "bytesIn" | "bytesOut" | "errors" | "droppedSnapshots" |
    "slowConsumers" | "disconnects", amount = 1): void {
    if (!Number.isFinite(amount) || amount < 0) throw new RangeError("Invalid metrics amount.");
    this.#host[kind] += amount;
    const session = this.#sessions.get(id);
    if (session) session[kind] += amount;
  }

  buffer(id: string, bytes: number): void {
    if (!Number.isFinite(bytes) || bytes < 0) throw new RangeError("Invalid buffered byte count.");
    this.#host.bufferHighWaterBytes = Math.max(this.#host.bufferHighWaterBytes, bytes);
    const session = this.#sessions.get(id);
    if (session) session.bufferHighWaterBytes = Math.max(session.bufferHighWaterBytes, bytes);
  }

  runner(id: string, entities: number, tick: number, missedDeadlines: number, droppedTimeMs: number): void {
    const session = this.#sessions.get(id);
    if (session) {
      this.#host.missedDeadlines += missedDeadlines - session.missedDeadlines;
      this.#host.droppedTimeMs += droppedTimeMs - session.droppedTimeMs;
      Object.assign(session, { entities, tick, missedDeadlines, droppedTimeMs });
    }
  }

  snapshot() {
    const serialize = (values: ReturnType<typeof measurements>) => ({
      ...values, simulation: values.simulation.snapshot(),
      snapshot: values.snapshot.snapshot(), rtt: values.rtt.snapshot()
    });
    const cpu = process.cpuUsage();
    const loopSamples = Number(this.#delay.count);
    const transport = this.#transport();
    return {
      sampledAt: new Date().toISOString(),
      limits: { sessions: MAX_SESSIONS, moduleMetricsPerSession: MAX_MODULE_METRICS },
      host: {
        ...serialize(this.#host), ...transport,
        uptimeSeconds: process.uptime(), rssBytes: process.memoryUsage().rss,
        cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000,
        eventLoopDelay: {
          samples: loopSamples, meanMs: loopSamples ? this.#delay.mean / 1e6 : null,
          maxMs: loopSamples ? this.#delay.max / 1e6 : null,
          p50Ms: loopSamples ? this.#delay.percentile(50) / 1e6 : null,
          p95Ms: loopSamples ? this.#delay.percentile(95) / 1e6 : null,
          p99Ms: loopSamples ? this.#delay.percentile(99) / 1e6 : null
        }
      },
      sessions: [...this.#sessions].map(([id, values]) => ({
        ...serialize(values), id, entities: values.entities, tick: values.tick,
        ...this.#transport(id), module: Object.fromEntries(values.module)
      }))
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#delay.disable();
    this.#sessions.clear();
  }
}

export function registerMetricsRoute(app: FastifyInstance, auth: AuthContext, metrics: RuntimeMetrics): void {
  app.get("/api/v1/admin/metrics", async (request, reply) => {
    const account = requireAccount(auth, request);
    if (account.role !== "operator") throw new HttpError(403, "FORBIDDEN", "Operator access is required.");
    reply.header("cache-control", "no-store");
    return metrics.snapshot();
  });
}
