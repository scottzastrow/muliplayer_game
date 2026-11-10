import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import { mountLobby } from "../apps/client/src/lobby.js";

class ElementStub extends EventTarget {
  readonly children: ElementStub[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  textContent = "";
  id = "";
  name = "";
  type = "";
  value = "";
  min = "";
  max = "";
  step = "";
  htmlFor = "";
  open = false;
  disabled = false;
  constructor(readonly tagName: string) { super(); }
  get childElementCount(): number { return this.children.length; }
  append(...nodes: ElementStub[]): void { this.children.push(...nodes); }
  replaceChildren(...nodes: ElementStub[]): void {
    this.children.splice(0, this.children.length, ...nodes);
  }
  setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
  descendants(): ElementStub[] {
    return this.children.flatMap(child => [child, ...child.descendants()]);
  }
  querySelector(selector: string): ElementStub | undefined {
    const name = /^\[name="([^"]+)"\]$/.exec(selector)?.[1];
    return this.descendants().find(child => child.name === name);
  }
}

describe("host NPC settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows End Session only beside a host's running status and confirms before sending", async () => {
    const elements: ElementStub[] = [];
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        const element = new ElementStub(tag);
        elements.push(element);
        return element;
      },
      createTextNode: (text: string) => Object.assign(new ElementStub("#text"), { textContent: text })
    });
    const sessions = [
      { id: "running", creator: "Host", status: "running" },
      { id: "waiting", creator: "Host", status: "waiting" },
      { id: "other", creator: "Guest", status: "running" }
    ];
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true, status: 200,
      json: async () => init?.method ? {} : { sessions }
    }));
    vi.stubGlobal("fetch", fetch);
    const root = document.createElement("div");
    const status = document.createElement("div");
    const rootStub = elements[0]!;
    mountLobby(root, status, {
      id: "host", username: "Host", role: "player", controlMode: "keyboard-only"
    }, vi.fn(), vi.fn(), vi.fn(), vi.fn());
    await vi.waitFor(() => expect(rootStub.descendants().filter(node =>
      node.textContent === "End Session")).toHaveLength(1));
    const end = rootStub.descendants().find(node => node.textContent === "End Session")!;
    const cell = rootStub.descendants().find(node => node.children.includes(end))!;
    expect(cell.children.slice(0, 2).map(node => node.textContent)).toEqual(["Running", "End Session"]);
    end.dispatchEvent(new Event("click"));
    expect(confirm).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalledWith("/api/v1/sessions/running/end", expect.anything());
    confirm.mockReturnValue(true);
    end.dispatchEvent(new Event("click"));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/v1/sessions/running/end",
      expect.objectContaining({ method: "POST", body: "{}" })));
    await vi.waitFor(() => expect(status.textContent).toBe("Session ended. Final results saved."));
  });

  it("labels, defaults and submits NPC speed on both create and creator edit", async () => {
    const createdElements: ElementStub[] = [];
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        const element = new ElementStub(tag);
        createdElements.push(element);
        return element;
      },
      createTextNode: (text: string) => Object.assign(new ElementStub("#text"), { textContent: text })
    });
    const session = {
      id: "room", creator: "Host", status: "waiting", themeName: "Dots and Squares",
      playerCount: 1, maxPlayers: 4, settingsRevision: 2, canJoin: false, canSpectate: false
    };
    const savedSettings = { ...DEFAULT_GAME_SETTINGS, initialNpcsPerPlayer: 8,
      npcMovementSpeed: 90, baseNpcHealth: 100 };
    const fetch = vi.fn(async (url: string, init?: RequestInit) => ({
      ok: true, status: 200,
      json: async () => url === "/api/v1/sessions" && !init?.method
        ? { sessions: [session] }
        : url === "/api/v1/sessions/room"
          ? { settings: savedSettings }
          : {}
    }));
    vi.stubGlobal("fetch", fetch);
    const root = document.createElement("div");
    const status = document.createElement("div");
    mountLobby(root, status, {
      id: "host", username: "Host", role: "player", controlMode: "keyboard-only"
    }, vi.fn(), vi.fn(), vi.fn(), vi.fn());
    const elements = () => createdElements[0]!.descendants();
    const createSpeed = elements().find(element => element.name === "setting-npcMovementSpeed")!;
    const createRange = elements().find(element => element.name === "setting-npcDetectionRange")!;
    const createNpcCount = elements().find(element => element.name === "setting-initialNpcsPerPlayer")!;
    const createTimeout = elements().find(element => element.name === "setting-noKillTimeoutSeconds")!;
    expect(createNpcCount.value).toBe("5");
    expect(createTimeout.value).toBe("60");
    expect([createTimeout.min, createTimeout.max, createTimeout.step]).toEqual(["0.001", "3600", "any"]);
    createTimeout.value = "45.5";
    const createMode = elements().find(element => element.name === "setting-mapMode")!;
    const densityMode = elements().find(element => element.name === "setting-densityMode")!;
    expect(createMode.value).toBe("fixed");
    createMode.value = "simple-generated";
    createMode.dispatchEvent(new Event("change"));
    expect(densityMode.disabled).toBe(false);
    expect(elements().find(element => element.name === "setting-startingDensity")!.value).toBe("3");
    expect(elements().find(element => element.name === "setting-increasePerLevel")!.value).toBe("0");
    expect(elements().find(element => element.name === "setting-baseNpcHealth")!.value).toBe("50");
    expect(createSpeed.value).toBe("67.5");
    expect([createSpeed.min, createSpeed.max, createSpeed.step]).toEqual(["0", "180", "any"]);
    expect(elements().find(element => element.htmlFor === createSpeed.id)?.textContent)
      .toBe("NPC movement speed");
    expect(elements().find(element => element.id === createSpeed.attributes.get("aria-describedby"))
      ?.textContent).toContain("world units/second");
    expect(createRange.value).toBe("512");
    expect([createRange.min, createRange.max, createRange.step]).toEqual(["0", "700", "any"]);
    expect(elements().find(element => element.htmlFor === createRange.id)?.textContent)
      .toBe("NPC detection range");
    expect(elements().find(element => element.id === createRange.attributes.get("aria-describedby"))
      ?.textContent).toContain("world units");
    createSpeed.value = "33.75";
    createRange.value = "300";
    createNpcCount.value = "7";
    const createForm = elements().find(element => element.tagName === "form" &&
      element.children.some(child => child.tagName === "fieldset" &&
        child.children.includes(createSpeed)))!;
    createForm.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/v1/sessions",
      expect.objectContaining({ method: "POST" })));
    const create = fetch.mock.calls.find(([url, init]) => url === "/api/v1/sessions" &&
      init?.method === "POST")!;
    expect(JSON.parse(String(create[1]!.body)).settings).toMatchObject({
      initialNpcsPerPlayer: 7, npcMovementSpeed: 33.75, npcDetectionRange: 300,
      baseNpcHealth: 50, noKillTimeoutSeconds: 45.5,
      mapMode: "simple-generated",
      terrainDensity: { mode: "incremental", startingDensity: 3, increasePerLevel: 0 }
    });
    densityMode.value = "per-level";
    densityMode.dispatchEvent(new Event("change"));
    const densities = elements().find(element => element.name === "setting-densities")!;
    expect(densities.disabled).toBe(false);
    densities.value = "0,3,10";
    elements().find(element => element.name === "setting-maxLevels")!.value = "3";
    createForm.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(fetch.mock.calls.filter(([url, init]) =>
      url === "/api/v1/sessions" && init?.method === "POST")).toHaveLength(2));
    const perLevelCreate = fetch.mock.calls.filter(([url, init]) =>
      url === "/api/v1/sessions" && init?.method === "POST")[1]!;
    expect(JSON.parse(String(perLevelCreate[1]!.body)).settings).toMatchObject({
      maxLevels: 3, terrainDensity: { mode: "per-level", densities: [0, 3, 10] }
    });

    await vi.waitFor(() => expect(elements().some(element => element.tagName === "details")).toBe(true));
    const controls = elements().find(element => element.tagName === "details")!;
    controls.open = true;
    controls.dispatchEvent(new Event("toggle"));
    await vi.waitFor(() => expect(controls.children.length).toBe(3));
    const editSpeed = controls.querySelector('[name="setting-npcMovementSpeed"]')!;
    const editRange = controls.querySelector('[name="setting-npcDetectionRange"]')!;
    const editHealth = controls.querySelector('[name="setting-baseNpcHealth"]')!;
    const editNpcCount = controls.querySelector('[name="setting-initialNpcsPerPlayer"]')!;
    expect(editHealth.value).toBe("100");
    expect(editSpeed.value).toBe("90");
    expect(editRange.value).toBe("512");
    expect(editNpcCount.value).toBe("8");
    editSpeed.value = "0";
    editRange.value = "0";
    editHealth.value = "75";
    controls.children.find(element => element.textContent === "Save settings")!
      .dispatchEvent(new Event("click"));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/v1/sessions/room/settings",
      expect.objectContaining({ method: "PATCH" })));
    const update = fetch.mock.calls.find(([url]) => url === "/api/v1/sessions/room/settings")!;
    expect(JSON.parse(String(update[1]!.body))).toEqual({
      settings: {
        ...DEFAULT_GAME_SETTINGS, initialNpcsPerPlayer: 8,
        npcMovementSpeed: 0, npcDetectionRange: 0, baseNpcHealth: 75
      }, expectedRevision: 2
    });
    const requestCount = fetch.mock.calls.filter(([url]) =>
      url === "/api/v1/sessions/room/settings").length;
    editSpeed.value = "";
    await vi.waitFor(() => expect(controls.children.find(element =>
      element.textContent === "Save settings")!.disabled).toBe(false));
    controls.children.find(element => element.textContent === "Save settings")!
      .dispatchEvent(new Event("click"));
    await vi.waitFor(() => expect(status.textContent).toBe("NPC movement speed is required."));
    expect(fetch.mock.calls.filter(([url]) =>
      url === "/api/v1/sessions/room/settings")).toHaveLength(requestCount);
    editSpeed.value = "67.5";
    editRange.value = "";
    await vi.waitFor(() => expect(controls.children.find(element =>
      element.textContent === "Save settings")!.disabled).toBe(false));
    controls.children.find(element => element.textContent === "Save settings")!
      .dispatchEvent(new Event("click"));
    await vi.waitFor(() => expect(status.textContent).toBe("NPC detection range is required."));
    expect(fetch.mock.calls.filter(([url]) =>
      url === "/api/v1/sessions/room/settings")).toHaveLength(requestCount);
  });
});
