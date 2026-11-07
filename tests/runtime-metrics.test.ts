import { describe, expect, it } from "vitest";
import { RuntimeMetrics, TimingHistogram, TIMING_BUCKETS_MS } from "../apps/server/src/runtime/metrics.js";
import { BoundedMessageSender } from "../apps/server/src/transport/socket.js";

describe("bounded runtime metrics", () => {
  it("uses fixed histogram buckets with honest empty and overflow percentiles", () => {
    const histogram = new TimingHistogram();
    expect(histogram.snapshot().p95Ms).toBeNull();
    for (const value of [1, 2, 33.3, 2000]) histogram.observe(value);
    expect(histogram.snapshot()).toMatchObject({
      count: 4, maxMs: 2000, p50Ms: 2, p95Ms: 2000, p99Ms: 2000
    });
    expect(histogram.snapshot().buckets).toHaveLength(TIMING_BUCKETS_MS.length + 1);
    expect(histogram.snapshot().buckets.reduce((sum, count) => sum + count, 0)).toBe(4);
    expect(() => histogram.observe(NaN)).toThrow("finite");
  });

  it("bounds session and module series, tracks traffic, and releases old labels", () => {
    const metrics = new RuntimeMetrics();
    try {
      for (let index = 0; index < 5; index++) metrics.startSession(`session-${index}`);
      expect(() => metrics.startSession("overflow")).toThrow("limit");
      const scoped = metrics.moduleMetrics("session-0");
      for (let index = 0; index < 32; index++) scoped.increment(`metric_${index}`);
      expect(() => scoped.gauge("another", 1)).toThrow("limit");
      expect(() => scoped.increment("Account Name")).toThrow("Invalid");
      expect(() => scoped.gauge("metric_0", Infinity)).toThrow("Invalid");
      metrics.event("session-0", "bytesIn", 100);
      metrics.event("session-0", "bytesOut", 200);
      metrics.timing("session-0", "simulation", 4);
      metrics.timing("session-0", "rtt", 10);
      metrics.buffer("session-0", 400);
      metrics.runner("session-0", 20, 10, 3, 100);
      expect(metrics.snapshot().sessions[0]).toMatchObject({
        entities: 20, tick: 10, missedDeadlines: 3, droppedTimeMs: 100,
        bytesIn: 100, bytesOut: 200, bufferHighWaterBytes: 400, rtt: { count: 1 }
      });
      metrics.releaseSession("session-0");
      expect(() => scoped.increment("metric_0")).toThrow("unavailable");
      metrics.startSession("replacement");
      expect(metrics.snapshot().sessions.map(({ id }) => id)).not.toContain("session-0");
      expect(metrics.snapshot().host.bytesOut).toBe(200);
    } finally { metrics.close(); }
  });

  it("records actual sent bytes, queued snapshots and slow-consumer closures", () => {
    const events: Array<[string, number]> = [];
    const buffers: number[] = [];
    const socket = {
      readyState: 1, bufferedAmount: 0, sent: [] as string[],
      send(value: string) { this.sent.push(value); },
      close() {}
    };
    const sender = new BoundedMessageSender(socket, 1024,
      (kind, amount = 1) => events.push([kind, amount]), (bytes) => buffers.push(bytes));
    sender.send({ v: 1, type: "server.pong", payload: { nonce: "one" } });
    expect(events).toContainEqual(["bytesOut", Buffer.byteLength(socket.sent[0]!)]);
    socket.bufferedAmount = 900;
    sender.send({ v: 1, type: "server.snapshot", payload: { tick: 1 } });
    expect(sender.bufferedBytes).toBeGreaterThan(900);
    socket.bufferedAmount = 1024;
    sender.send({ v: 1, type: "server.snapshot", payload: { tick: 2 } });
    expect(events).toContainEqual(["droppedSnapshots", 1]);
    sender.send({ v: 1, type: "server.pong", payload: { nonce: "two" } });
    expect(events).toContainEqual(["slowConsumers", 1]);
    expect(buffers).toHaveLength(2);
  });
});
