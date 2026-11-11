import { afterEach, describe, expect, it, vi } from "vitest";
import { mountAppearance } from "../apps/client/src/appearance.js";

class ElementStub extends EventTarget {
  textContent = "";
  className = "";
  id = "";
  htmlFor = "";
  value = "";
  readonly children: ElementStub[] = [];
  readonly dataset: Record<string, string> = {};
  setAttribute(): void {}
  append(...nodes: ElementStub[]): void { this.children.push(...nodes); }
}

function setup(saved: string | null = null, dark = false) {
  const html = new ElementStub();
  const root = new ElementStub();
  const status = new ElementStub();
  const media = Object.assign(new EventTarget(), { matches: dark });
  const storage = { getItem: vi.fn(() => saved), setItem: vi.fn() };
  vi.stubGlobal("document", {
    documentElement: html,
    createElement: () => new ElementStub()
  });
  vi.stubGlobal("window", { localStorage: storage, matchMedia: vi.fn(() => media) });
  return { html, root, status, media, storage };
}

describe("frontend appearance", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it.each([false, true])("uses system dark=%s on first visit without storing it", dark => {
    const { html, root, status, storage } = setup(null, dark);
    mountAppearance(root as unknown as HTMLElement, status as unknown as HTMLElement);
    expect(html.dataset.appearance).toBe(dark ? "dark" : "light");
    expect(storage.setItem).not.toHaveBeenCalled();
    const control = root.children[0]!;
    expect(control.children[0]!.textContent).toBe("Appearance");
    expect(control.children[0]!.htmlFor).toBe(control.children[1]!.id);
    expect(control.children[1]!.children.map(option => option.value)).toEqual(["light", "dark"]);
  });

  it.each(["light", "dark"])("restores saved %s regardless of system preference", saved => {
    const { html, root, status, media } = setup(saved, saved === "light");
    mountAppearance(root as unknown as HTMLElement, status as unknown as HTMLElement);
    media.matches = !media.matches;
    media.dispatchEvent(new Event("change"));
    expect(html.dataset.appearance).toBe(saved);
  });

  it("follows system changes until an explicit choice and disposes its listeners", () => {
    const { html, root, status, media, storage } = setup();
    const dispose = mountAppearance(root as unknown as HTMLElement, status as unknown as HTMLElement);
    media.matches = true;
    media.dispatchEvent(new Event("change"));
    expect(html.dataset.appearance).toBe("dark");
    const select = root.children[0]!.children[1]!;
    select.value = "light";
    select.dispatchEvent(new Event("change"));
    expect(storage.setItem).toHaveBeenCalledWith("frontend-appearance", "light");
    media.dispatchEvent(new Event("change"));
    expect(html.dataset.appearance).toBe("light");
    dispose();
    select.value = "dark";
    select.dispatchEvent(new Event("change"));
    expect(html.dataset.appearance).toBe("light");
  });

  it("ignores an invalid stored value in favor of the system", () => {
    const { html, root, status } = setup("sepia", true);
    mountAppearance(root as unknown as HTMLElement, status as unknown as HTMLElement);
    expect(html.dataset.appearance).toBe("dark");
  });

  it("reports inaccessible storage while retaining a working session choice", () => {
    const { html, root, status, storage } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    storage.getItem.mockImplementation(() => { throw new Error("Storage denied"); });
    storage.setItem.mockImplementation(() => { throw new Error("Storage denied"); });
    mountAppearance(root as unknown as HTMLElement, status as unknown as HTMLElement);
    expect(status.textContent).toContain("saved appearance");
    const select = root.children[0]!.children[1]!;
    select.value = "dark";
    select.dispatchEvent(new Event("change"));
    expect(html.dataset.appearance).toBe("dark");
    expect(status.textContent).toContain("could not be remembered");
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
