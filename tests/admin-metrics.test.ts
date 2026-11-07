import { afterEach, describe, expect, it, vi } from "vitest";
import { mountAdminMetrics } from "../apps/client/src/admin-metrics.js";

class ElementStub extends EventTarget {
  readonly children: ElementStub[] = [];
  readonly attributes = new Map<string, string>();
  textContent = "";
  id = "";
  type = "";
  download = "";
  href = "";
  hidden = false;
  disabled = false;
  append(...nodes: ElementStub[]): void { this.children.push(...nodes); }
  setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
}

describe("operator metrics view", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refreshes and offers a JSON download, hiding stale data on failures", async () => {
    vi.stubGlobal("document", { createElement: () => new ElementStub() });
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ host: { rssBytes: 123 }, sessions: [] }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: "Operator access is required." } }) });
    vi.stubGlobal("fetch", fetch);
    const status = document.createElement("div");
    const section = mountAdminMetrics(status);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const refresh = section.children[2] as HTMLButtonElement;
    const download = section.children[3] as HTMLAnchorElement;
    const output = section.children[4] as HTMLElement;
    await vi.waitFor(() => expect(download.hidden).toBe(false));
    expect(output.textContent).toContain('"rssBytes": 123');
    expect(download.href).toContain("data:application/json");
    refresh.dispatchEvent(new Event("click"));
    await vi.waitFor(() => expect(status.textContent).toBe("Operator access is required."));
    expect(download.hidden).toBe(true);
    expect(output.textContent).toBe("");
    expect(refresh.disabled).toBe(false);
  });
});
