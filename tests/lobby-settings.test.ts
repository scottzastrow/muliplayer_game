import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import { mountLobby } from "../apps/client/src/lobby.js";
import { mountAuth, selectedControlMode } from "../apps/client/src/auth.js";

class ElementStub extends EventTarget {
  readonly children: ElementStub[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  textContent = "";
  className = "";
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
  checked = false;
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
    if (selector === 'input[name="controlMode"]:checked') {
      return this.descendants().find(child => child.name === "controlMode" && child.checked);
    }
    const name = /^\[name="([^"]+)"\]$/.exec(selector)?.[1];
    return this.descendants().find(child => child.name === name);
  }
  querySelectorAll(selector: string): ElementStub[] {
    return this.descendants().filter(child => child.tagName === selector);
  }
}

describe("lobby settings and control preferences", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["keyboard-only", "keyboard-mouse", "game-controller"] as const)(
    "offers all three canonical signup choices and submits %s", async controlMode => {
      const root = new ElementStub("div");
      const status = new ElementStub("div");
      vi.stubGlobal("document", {
        createElement: (tag: string) => new ElementStub(tag),
        createTextNode: (text: string) => Object.assign(new ElementStub("#text"), { textContent: text })
      });
      const fetch = vi.fn(async () => ({
        ok: true, status: 201, json: async () => ({ account: { controlMode } })
      }));
      vi.stubGlobal("fetch", fetch);
      await mountAuth(root as unknown as HTMLElement, status as unknown as HTMLElement, vi.fn());
      const form = root.children[0]!;
      form.children.find(node => node.className === "link-button")!.dispatchEvent(new Event("click"));
      const choices = root.descendants().find(node => node.tagName === "fieldset")!;
      const radios = choices.descendants().filter(node => node.name === "controlMode");
      expect(radios.map(node => node.value)).toEqual([
        "keyboard-only", "keyboard-mouse", "game-controller"
      ]);
      expect(radios.every(node => !node.disabled && !node.checked)).toBe(true);
      expect(choices.descendants().map(node => node.textContent).join(" ")).not.toContain("First-Person");
      root.descendants().find(node => node.name === "username")!.value = "Pilot";
      root.descendants().find(node => node.name === "password")!.value = "password123";
      radios.find(node => node.value === controlMode)!.checked = true;
      form.dispatchEvent(new Event("submit", { cancelable: true }));
      await vi.waitFor(() => expect(status.textContent).toContain("Account created."));
      expect(fetch).toHaveBeenCalledWith("/api/v1/auth/register", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "Pilot", password: "password123", controlMode })
      }));
    }
  );

  it.each(["keyboard-only", "keyboard-mouse", "game-controller"] as const)(
    "offers all three canonical lobby preferences and restores/saves %s", async controlMode => {
      vi.stubGlobal("document", {
        createElement: (tag: string) => new ElementStub(tag),
        createTextNode: (text: string) => Object.assign(new ElementStub("#text"), { textContent: text })
      });
      const account = { id: "pilot", username: "Pilot", role: "player" as const, controlMode };
      const fetch = vi.fn(async (url: string) => ({
        ok: true, status: 200,
        json: async () => url === "/api/v1/me/control-mode" ? { account } : { sessions: [] }
      }));
      vi.stubGlobal("fetch", fetch);
      const root = new ElementStub("div");
      const status = new ElementStub("div");
      const onSaved = vi.fn();
      mountLobby(root as unknown as HTMLElement, status as unknown as HTMLElement, account,
        vi.fn(), onSaved, vi.fn(), vi.fn());
      const form = root.descendants().find(node => node.tagName === "form")!;
      const choices = form.children[0]!;
      const radios = choices.descendants().filter(node => node.name === "controlMode");
      expect(radios.map(node => node.value)).toEqual([
        "keyboard-only", "keyboard-mouse", "game-controller"
      ]);
      expect(radios.filter(node => node.checked).map(node => node.value)).toEqual([controlMode]);
      form.dispatchEvent(new Event("submit", { cancelable: true }));
      await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(account));
      expect(fetch).toHaveBeenCalledWith("/api/v1/me/control-mode", expect.objectContaining({
        method: "PATCH", body: JSON.stringify({ controlMode })
      }));
      radios.forEach(node => { node.checked = false; });
      expect(selectedControlMode(choices as unknown as HTMLFieldSetElement)).toBeUndefined();
      radios[0]!.value = "first-person";
      radios[0]!.checked = true;
      expect(selectedControlMode(choices as unknown as HTMLFieldSetElement)).toBeUndefined();
    }
  );

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
      npcMovementSpeed: 90, baseNpcHealth: 100, playerMaxHealth: 275 };
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
    const createPlayerHealth = elements().find(element => element.name === "setting-playerMaxHealth")!;
    expect(createPlayerHealth.value).toBe("200");
    expect([createPlayerHealth.min, createPlayerHealth.max, createPlayerHealth.step]).toEqual(["1", "100000", "1"]);
    createPlayerHealth.value = "37";
    expect(createNpcCount.value).toBe("5");
    expect(createTimeout.value).toBe("360");
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
      baseNpcHealth: 50, noKillTimeoutSeconds: 45.5, playerMaxHealth: 37,
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
    expect(controls.querySelector('[name="setting-playerMaxHealth"]')!.value).toBe("275");
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
        npcMovementSpeed: 0, npcDetectionRange: 0, baseNpcHealth: 75, playerMaxHealth: 275
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
