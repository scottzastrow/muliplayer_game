import { createHash, randomBytes } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync, openSync, closeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocket } from "ws";
import { z } from "zod";
import {
  ClientEnvelopeSchema, ServerEnvelopeSchema, GameSettingsSchema, validateMatchCapacity,
  type ClientEnvelope, type ServerEnvelope
} from "@multiplayer-game/protocol";

const PointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export const LoadViewSchema = z.object({
  phase: z.enum(["active", "intermission", "complete"]),
  map: z.object({
    width: z.number().positive().max(2048), height: z.number().positive().max(2048),
    obstacles: z.array(z.object({
      x: z.number().finite(), y: z.number().finite(),
      width: z.number().positive().finite(), height: z.number().positive().finite()
    })).max(4096)
  }),
  players: z.array(z.object({
    accountId: z.string(), position: PointSchema, health: z.number().nonnegative().finite(),
    alive: z.boolean()
  })).max(32),
  entities: z.array(z.object({
    id: z.string(), position: PointSchema,
    state: z.object({ kind: z.enum(["npc", "player", "pickup", "projectile"]) })
  })).max(3200)
});
type LoadView = z.infer<typeof LoadViewSchema>;

const MAX_CLIENT_BUFFER_BYTES = 16 * 1024;
const MAX_SERVER_MESSAGE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const TICK_MS = 1000 / 30;

const OriginSchema = z.string().url().refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
      url.pathname === "/" && !url.search && !url.hash;
  }, "Use an HTTP(S) origin without credentials, path or query.");

export const WorkloadSchema = z.object({
  target: OriginSchema,
  origin: OriginSchema.optional(),
  seed: z.number().int().min(0).max(0xffffffff),
  playersPerRoom: z.number().int().min(1).max(32),
  spectatorsPerRoom: z.number().int().min(0).max(64),
  registrationIntervalMs: z.number().int().min(0).max(60_000).default(12500),
  warmupSeconds: z.number().finite().min(0).max(300),
  steps: z.array(z.object({
    rooms: z.number().int().min(1).max(5),
    seconds: z.number().finite().min(0.1).max(1800)
  }).strict()).min(1).max(5),
  soakSeconds: z.number().finite().min(0).max(1800),
  settings: GameSettingsSchema
}).strict().superRefine((value, ctx) => {
  if (value.settings.maxPlayers < value.playersPerRoom ||
      value.settings.maxSpectators < value.spectatorsPerRoom) {
    ctx.addIssue({ code: "custom", message: "Room settings cannot hold the workload members." });
  }
  if (!["default@1.0.0", "fixture@1.0.0"].includes(value.settings.themeRevision)) {
    ctx.addIssue({ code: "custom", message: "The combat workload supports only the reference themes." });
  }
  let previous = 0;
  for (const step of value.steps) {
    if (step.rooms <= previous) {
      ctx.addIssue({ code: "custom", message: "Steps must add rooms in strictly increasing order." });
    }
    previous = step.rooms;
  }
  try {
    validateMatchCapacity(value.settings, value.playersPerRoom);
  } catch (error) {
    ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid capacity." });
  }
});
export type Workload = z.infer<typeof WorkloadSchema>;

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

export function combatIntent(view: LoadView, accountId: string, random: () => number) {
  const player = view.players.find((candidate) => candidate.accountId === accountId);
  if (!player) throw new Error("Snapshot is missing the workload player.");
  const neutral = {
    type: "combat" as const, moveX: 0, moveY: 0,
    aimX: player.position.x, aimY: player.position.y, fire: false
  };
  if (!player.alive || view.phase !== "active") return neutral;
  const distance = (position: { x: number; y: number }) =>
    Math.hypot(position.x - player.position.x, position.y - player.position.y);
  const enemies = view.entities.filter((entity) => entity.state.kind === "npc")
    .sort((a, b) => distance(a.position) - distance(b.position) || a.id.localeCompare(b.id));
  const pickups = view.entities.filter((entity) => entity.state.kind === "pickup")
    .sort((a, b) => distance(a.position) - distance(b.position) || a.id.localeCompare(b.id));
  const enemy = enemies[0];
  const target = (player.health < 50 ? pickups[0] : undefined) ?? enemy ?? pickups[0];
  const angle = random() * Math.PI * 2;
  const dx = target ? target.position.x - player.position.x : Math.cos(angle);
  const dy = target ? target.position.y - player.position.y : Math.sin(angle);
  const length = Math.hypot(dx, dy) || 1;
  let moveX = dx / length;
  let moveY = dy / length;
  const blocked = (x: number, y: number) => {
    const nextX = player.position.x + x * 24;
    const nextY = player.position.y + y * 24;
    return nextX < 12 || nextY < 12 || nextX > view.map.width - 12 ||
      nextY > view.map.height - 12 || view.map.obstacles.some((obstacle) =>
        nextX > obstacle.x - 12 && nextX < obstacle.x + obstacle.width + 12 &&
        nextY > obstacle.y - 12 && nextY < obstacle.y + obstacle.height + 12);
  };
  if (blocked(moveX, moveY)) {
    moveX = 0;
    moveY = 0;
    for (let index = 0; index < 8; index++) {
      const candidate = angle + index * Math.PI / 4;
      const x = Math.cos(candidate), y = Math.sin(candidate);
      if (!blocked(x, y)) { moveX = x; moveY = y; break; }
    }
  }
  return {
    ...neutral, moveX, moveY, aimX: enemy?.position.x ?? player.position.x,
    aimY: enemy?.position.y ?? player.position.y, fire: Boolean(enemy)
  };
}

class LatencyBuckets {
  readonly counts = Array<number>(12).fill(0);
  readonly bounds = [1, 2, 5, 10, 20, 33.3, 50, 100, 250, 500, 1000];
  count = 0;
  maxMs = 0;
  observe(ms: number): void {
    const index = this.bounds.findIndex((bound) => ms <= bound);
    this.counts[index < 0 ? this.bounds.length : index]! += 1;
    this.count++;
    this.maxMs = Math.max(this.maxMs, ms);
  }
  snapshot() {
    const percentile = (percent: number) => {
      if (!this.count) return null;
      let total = 0;
      for (let index = 0; index < this.counts.length; index++) {
        total += this.counts[index]!;
        if (total >= Math.ceil(this.count * percent)) return this.bounds[index] ?? this.maxMs;
      }
      return this.maxMs;
    };
    return {
      samples: this.count, maxMs: this.maxMs, p50Ms: percentile(.5),
      p95Ms: percentile(.95), p99Ms: percentile(.99),
      bucketUpperBoundsMs: [...this.bounds, null], buckets: [...this.counts]
    };
  }
}

function counters() {
  return {
    bytesIn: 0, bytesOut: 0, snapshots: 0, actions: 0, firingActions: 0, movingActions: 0,
    bufferHighWaterBytes: 0, rtt: new LatencyBuckets()
  };
}

interface Account {
  readonly id: string;
  readonly cookie: string;
}
interface Client {
  readonly account: Account;
  readonly sessionId: string;
  readonly role: "player" | "spectator";
  readonly socket: WebSocket;
  readonly random: () => number;
  view?: LoadView;
  lastMessageAt: number;
  sequence: number;
  nextPingAt: number;
  pendingPing?: { nonce: string; startedAt: number };
  stats: ReturnType<typeof counters>;
}

export async function runLoad(input: unknown, signal?: AbortSignal) {
  const config = WorkloadSchema.parse(input);
  const startedAt = new Date().toISOString();
  const runId = randomBytes(4).toString("hex");
  const clients: Client[] = [];
  const accounts: Account[] = [];
  const rooms: Array<{ id: string; members: Account[]; mapFingerprint?: string;
    pinnedTheme?: { revision: string; digest: string } }> = [];
  const phases: Array<{ name: string; rooms: number; seconds: number;
    clients: ReturnType<typeof summarize>[] }> = [];
  const failures: string[] = [];
  const cleanupFailures: string[] = [];
  let stopping = false;
  let nextRegistrationAt = 0;
  let behaviorIndex = 0;
  let fatal: Error | undefined;

  function summarize(client: Client) {
    return {
      sessionId: client.sessionId, role: client.role,
      ...client.stats, rtt: client.stats.rtt.snapshot()
    };
  }
  function fail(message: string): void { fatal ??= new Error(message); }
  function check(): void {
    if (signal?.aborted) throw new Error("Load run aborted.");
    if (fatal) throw fatal;
  }
  async function sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(new Error("Load run aborted.")); return; }
      const onAbort = () => { clearTimeout(timer); reject(new Error("Load run aborted.")); };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, Math.max(0, ms));
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    check();
  }
  async function api(path: string, cookie?: string, body?: unknown): Promise<unknown> {
    const response = await fetch(new URL(`/api/v1${path}`, config.target), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin: config.origin ?? new URL(config.target).origin,
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const text = await response.text();
    if (!response.ok) {
      let errorBody: unknown;
      try { errorBody = JSON.parse(text); }
      catch { throw new Error(`${path}: HTTP ${response.status} non-JSON error response.`); }
      const parsed = z.object({ error: z.object({ code: z.string(), message: z.string() }) })
        .safeParse(errorBody);
      const reason = parsed.success ? `${parsed.data.error.code}: ${parsed.data.error.message}` :
        "Invalid HTTP error response.";
      throw new Error(`${path}: HTTP ${response.status} ${reason}`);
    }
    return response.status === 204 ? undefined : JSON.parse(text);
  }
  async function account(): Promise<Account> {
    check();
    await sleep(Math.max(0, nextRegistrationAt - performance.now()));
    const username = `Load_${runId}_${accounts.length}`;
    const password = randomBytes(24).toString("hex");
    nextRegistrationAt = performance.now() + config.registrationIntervalMs;
    await api("/auth/register", undefined, { username, password });
    const response = await fetch(new URL("/api/v1/auth/login", config.target), {
      method: "POST", headers: {
        origin: config.origin ?? new URL(config.target).origin, "content-type": "application/json"
      },
      body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`/auth/login: HTTP ${response.status}`);
    const body = z.object({ account: z.object({ id: z.string().uuid() }) }).parse(await response.json());
    const cookie = response.headers.getSetCookie()[0]?.split(";", 1)[0];
    if (!cookie) throw new Error("Login returned no session cookie.");
    const result = { id: body.account.id, cookie };
    accounts.push(result);
    return result;
  }
  function send(client: Client, input: ClientEnvelope): void {
    if (client.socket.readyState !== WebSocket.OPEN) throw new Error("Workload socket is not open.");
    const data = JSON.stringify(ClientEnvelopeSchema.parse(input));
    const bytes = Buffer.byteLength(data);
    if (client.socket.bufferedAmount + bytes > MAX_CLIENT_BUFFER_BYTES) {
      throw new Error("Load client exceeded its 16 KiB control queue.");
    }
    client.socket.send(data);
    client.stats.bytesOut += bytes;
    client.stats.bufferHighWaterBytes = Math.max(client.stats.bufferHighWaterBytes,
      client.socket.bufferedAmount);
  }
  async function connect(member: Account, sessionId: string, role: Client["role"]): Promise<Client> {
    const url = new URL("/ws", config.target);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("sessionId", sessionId);
    const socket = new WebSocket(url, {
      headers: { origin: config.origin ?? new URL(config.target).origin, cookie: member.cookie },
      maxPayload: MAX_SERVER_MESSAGE_BYTES, perMessageDeflate: false, handshakeTimeout: REQUEST_TIMEOUT_MS
    });
    const client: Client = {
      account: member, sessionId, role, socket,
      random: seededRandom(config.seed + behaviorIndex++), sequence: 0,
      lastMessageAt: performance.now(), nextPingAt: 0, stats: counters()
    };
    clients.push(client);
    socket.on("error", () => { if (!stopping) fail(`Socket error in ${sessionId} (${role}).`); });
    socket.on("close", (code) => {
      if (!stopping) fail(`Unexpected socket close ${code} in ${sessionId} (${role}).`);
    });
    let hello = false;
    socket.on("message", (raw, binary) => {
      if (stopping) return;
      try {
        if (binary) throw new Error("Server returned a binary protocol message.");
        const data = raw.toString();
        client.stats.bytesIn += Buffer.byteLength(data);
        client.lastMessageAt = performance.now();
        const message: ServerEnvelope = ServerEnvelopeSchema.parse(JSON.parse(data));
        if (message.sessionId !== sessionId) throw new Error("Cross-room server message.");
        if (message.type === "server.error") {
          throw new Error(`Server ${message.payload.code}: ${message.payload.message}`);
        }
        if (message.type === "server.hello") {
          const payload = z.object({
            role: z.enum(["player", "spectator"]),
            pinnedTheme: z.object({ revision: z.string(), digest: z.string().regex(/^[a-f0-9]{64}$/) })
          }).parse(message.payload);
          if (payload.role !== role) throw new Error("Server returned the wrong workload role.");
          const room = rooms.find((room) => room.id === sessionId);
          if (!room) throw new Error("Hello refers to an unknown workload room.");
          room.pinnedTheme = payload.pinnedTheme;
          hello = true;
        } else if (message.type === "server.snapshot") {
          client.view = LoadViewSchema.parse(message.payload);
          client.stats.snapshots++;
          const room = rooms.find((room) => room.id === sessionId);
          if (room && !room.mapFingerprint) {
            room.mapFingerprint = createHash("sha256").update(JSON.stringify(client.view.map)).digest("hex");
          }
        } else if (message.type === "server.pong" && client.pendingPing) {
          if (message.payload.nonce !== client.pendingPing.nonce) throw new Error("Ping nonce mismatch.");
          client.stats.rtt.observe(performance.now() - client.pendingPing.startedAt);
          delete client.pendingPing;
        } else if (message.type === "server.lifecycle") {
          throw new Error(`Match ended during workload: ${String(message.payload.status)}.`);
        } else if (message.type === "server.spectate.target" &&
          message.payload.targetAccountId === null) {
          throw new Error("Spectator workload target became unavailable.");
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : "Invalid server message.");
      }
    });
    const deadline = performance.now() + REQUEST_TIMEOUT_MS;
    while (!hello) {
      if (performance.now() > deadline) throw new Error("Timed out waiting for server.hello.");
      await sleep(10);
    }
    return client;
  }
  async function addRoom(): Promise<void> {
    const players: Account[] = [];
    const spectators: Account[] = [];
    // Provision before start so auth pacing cannot consume reconnect reservations.
    for (let index = 0; index < config.playersPerRoom; index++) players.push(await account());
    for (let index = 0; index < config.spectatorsPerRoom; index++) spectators.push(await account());
    const creator = players[0];
    if (!creator) throw new Error("Workload room has no creator.");
    const created = z.object({ session: z.object({ id: z.string().uuid() }) })
      .parse(await api("/sessions", creator.cookie, { settings: config.settings }));
    const id = created.session.id;
    const room = { id, members: [creator] };
    rooms.push(room);
    for (const player of players.slice(1)) {
      await api(`/sessions/${id}/join`, player.cookie, {});
      room.members.push(player);
    }
    await api(`/sessions/${id}/start`, creator.cookie, { expectedRevision: 0 });
    for (const player of players) await connect(player, id, "player");
    for (const spectator of spectators) {
      await api(`/sessions/${id}/spectate`, spectator.cookie, {});
      room.members.push(spectator);
      const client = await connect(spectator, id, "spectator");
      send(client, { v: 1, type: "client.spectate.target", payload: { targetAccountId: creator.id } });
    }
    const deadline = performance.now() + REQUEST_TIMEOUT_MS;
    while (clients.some((client) => !client.view)) {
      if (performance.now() > deadline) throw new Error("Timed out waiting for workload snapshots.");
      await sleep(10);
    }
  }
  async function phase(name: string, seconds: number): Promise<void> {
    for (const client of clients) client.stats = counters();
    const beginning = performance.now();
    try {
      while (performance.now() - beginning < seconds * 1000) {
        check();
        for (const client of clients) {
          const now = performance.now();
          if (now - client.lastMessageAt > REQUEST_TIMEOUT_MS) throw new Error("Server message timeout.");
          if (client.pendingPing && now - client.pendingPing.startedAt > REQUEST_TIMEOUT_MS) {
            throw new Error("Application ping timed out.");
          }
          if (!client.pendingPing && now >= client.nextPingAt) {
            const nonce = `${client.sequence}-${Math.floor(now)}`;
            client.pendingPing = { nonce, startedAt: now };
            client.nextPingAt = now + 1000;
            send(client, { v: 1, type: "client.ping", payload: { nonce } });
          }
          if (client.role === "player" && client.view) {
            const action = combatIntent(client.view, client.account.id, client.random);
            send(client, { v: 1, type: "client.input", payload: { sequence: client.sequence++, action } });
            client.stats.actions++;
            if (action.fire) client.stats.firingActions++;
            if (action.moveX || action.moveY) client.stats.movingActions++;
          }
        }
        await sleep(TICK_MS);
      }
    } finally {
      phases.push({ name, rooms: rooms.length, seconds: (performance.now() - beginning) / 1000,
        clients: clients.map(summarize) });
    }
  }
  try {
    for (let index = 0; index < config.steps.length; index++) {
      const step = config.steps[index];
      if (!step) throw new Error("Missing workload step.");
      while (rooms.length < step.rooms) await addRoom();
      await phase(`warmup-${index + 1}`, config.warmupSeconds);
      await phase(`step-${index + 1}`, step.seconds);
    }
    if (config.soakSeconds) await phase("soak", config.soakSeconds);
    check();
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "Load run failed.");
  } finally {
    stopping = true;
    for (const client of clients) client.socket.terminate();
    for (const room of rooms) {
      for (const member of room.members) {
        try { await api(`/sessions/${room.id}/leave`, member.cookie, {}); }
        catch (error) { cleanupFailures.push(error instanceof Error ? error.message : "Leave failed."); }
      }
    }
    for (const member of accounts) {
      try { await api("/auth/logout", member.cookie, {}); }
      catch (error) { cleanupFailures.push(error instanceof Error ? error.message : "Logout failed."); }
    }
  }
  return {
    version: 1, status: failures.length || cleanupFailures.length ? "failed" : "completed",
    startedAt, finishedAt: new Date().toISOString(), config,
    client: { node: process.version, platform: process.platform, arch: process.arch },
    seedScope: "Client decisions only; server map seeds are not selectable through the public API.",
    rooms: rooms.map(({ id, mapFingerprint, pinnedTheme }) => ({ id, mapFingerprint, pinnedTheme })),
    phases, failures, cleanupFailures
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.includes("--authorized")) {
    throw new Error("Pass --authorized only for an operator-authorized disposable test target.");
  }
  const configIndex = args.indexOf("--config");
  const outputIndex = args.indexOf("--output");
  const configPath = args[configIndex + 1];
  const outputPath = args[outputIndex + 1];
  if (configIndex < 0 || outputIndex < 0 || !configPath || !outputPath ||
    args.length !== 5 || configPath.startsWith("--") || outputPath.startsWith("--")) {
    throw new Error("Usage: npm run load -- --authorized --config <workload.json> --output <report.json>");
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const config = WorkloadSchema.parse(JSON.parse(readFileSync(resolve(configPath), "utf8")));
    const output = resolve(outputPath);
    mkdirSync(dirname(output), { recursive: true });
    const file = openSync(output, "wx");
    try {
      const report = await runLoad(config, controller.signal);
      writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify({ status: report.status, output, failures: report.failures,
        cleanupFailures: report.cleanupFailures }));
      if (report.status !== "completed") process.exitCode = 1;
    } finally { closeSync(file); }
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Load harness failed.");
    process.exitCode = 1;
  });
}
