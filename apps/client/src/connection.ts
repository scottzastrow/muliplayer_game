import {
  ClientEnvelopeSchema,
  ServerEnvelopeSchema,
  type JsonValue,
  type ServerEnvelope
} from "@multiplayer-game/protocol";

export interface RealtimeClientOptions {
  readonly sessionId: string;
  readonly onOpen?: () => void;
  readonly onMessage: (message: ServerEnvelope) => void;
  readonly onClose?: (event: CloseEvent) => void;
  readonly onError?: (event: Event) => void;
  readonly createWebSocket?: (url: string) => WebSocket;
}

export interface RealtimeClient {
  readonly socket: WebSocket;
  sendAction(action: JsonValue): boolean;
  sendPing(nonce: string): boolean;
  selectTarget(targetAccountId: string): boolean;
  close(): void;
}

export function connectRealtime(options: RealtimeClientOptions): RealtimeClient {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    options.sessionId
  )) {
    throw new TypeError("A valid session identifier is required.");
  }
  const url = new URL("/ws", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("sessionId", options.sessionId);
  const socket = (options.createWebSocket ?? ((target) => new WebSocket(target)))(url.toString());
  let nextSequence = 0;

  socket.addEventListener("open", () => options.onOpen?.());
  socket.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (typeof event.data !== "string") {
      socket.close(1002, "Expected a text protocol message.");
      return;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(event.data);
    } catch {
      socket.close(1002, "Invalid JSON from server.");
      return;
    }
    const parsed = ServerEnvelopeSchema.safeParse(decoded);
    if (!parsed.success) {
      socket.close(1002, "Invalid realtime protocol message.");
      return;
    }
    options.onMessage(parsed.data);
  });
  socket.addEventListener("close", (event) => options.onClose?.(event));
  socket.addEventListener("error", (event) => options.onError?.(event));

  return {
    socket,
    selectTarget(targetAccountId): boolean {
      const envelope = ClientEnvelopeSchema.parse({
        v: 1, type: "client.spectate.target", payload: { targetAccountId }
      });
      if (socket.readyState !== WebSocket.OPEN) return false;
      const serialized = JSON.stringify(envelope);
      if (socket.bufferedAmount + new TextEncoder().encode(serialized).byteLength > 16 * 1024) {
        socket.close(1013, "Outgoing controls stalled; reconnect to resync.");
        return false;
      }
      socket.send(serialized);
      return true;
    },
    sendAction(action): boolean {
      if (socket.readyState !== WebSocket.OPEN) {
        return false;
      }
      const envelope = ClientEnvelopeSchema.safeParse({
        v: 1,
        type: "client.input",
        payload: { sequence: nextSequence, action }
      });
      if (!envelope.success) {
        throw new TypeError("Module action must be a bounded JSON value.");
      }
      const serialized = JSON.stringify(envelope.data);
      if (socket.bufferedAmount + new TextEncoder().encode(serialized).byteLength > 16 * 1024) {
        socket.close(1013, "Outgoing controls stalled; reconnect to resync.");
        return false;
      }
      socket.send(serialized);
      nextSequence += 1;
      return true;
    },
    sendPing(nonce): boolean {
      if (socket.readyState !== WebSocket.OPEN) {
        return false;
      }
      const envelope = ClientEnvelopeSchema.safeParse({
        v: 1,
        type: "client.ping",
        payload: { nonce }
      });
      if (!envelope.success) {
        throw new TypeError("Ping nonce must be a string of 1–64 characters.");
      }
      socket.send(JSON.stringify(envelope.data));
      return true;
    },
    close(): void {
      socket.close(1000, "Leaving session.");
    }
  };
}
