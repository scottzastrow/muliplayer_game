import { showStatus } from "./ui.js";

type Appearance = "light" | "dark";
const STORAGE_KEY = "frontend-appearance";
let control: HTMLElement | undefined;

export function getAppearanceControl(): HTMLElement | undefined {
  return control;
}

export function mountAppearance(root: HTMLElement, status: HTMLElement): () => void {
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  let choice: Appearance | undefined;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") choice = saved;
  } catch (error) {
    console.warn("Unable to read the saved frontend appearance.", error);
    showStatus(status, "Your saved appearance is unavailable. Using the system preference.");
  }
  const group = document.createElement("div");
  group.className = "appearance-control";
  const label = document.createElement("label");
  label.htmlFor = "frontend-appearance";
  label.textContent = "Appearance";
  const select = document.createElement("select");
  select.id = label.htmlFor;
  for (const [value, text] of [["light", "Light"], ["dark", "Dark"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    select.append(option);
  }
  const apply = (): void => {
    const appearance = choice ?? (system.matches ? "dark" : "light");
    document.documentElement.dataset.appearance = appearance;
    select.value = appearance;
  };
  const change = (): void => {
    if (select.value !== "light" && select.value !== "dark") {
      throw new Error("Unsupported frontend appearance.");
    }
    choice = select.value;
    apply();
    try {
      window.localStorage.setItem(STORAGE_KEY, choice);
    } catch (error) {
      console.warn("Unable to save the frontend appearance.", error);
      showStatus(status, "Appearance changed, but could not be remembered on this device.");
    }
  };
  select.addEventListener("change", change);
  system.addEventListener("change", apply);
  group.append(label, select);
  root.append(group);
  control = group;
  apply();
  return () => {
    select.removeEventListener("change", change);
    system.removeEventListener("change", apply);
    if (control === group) control = undefined;
  };
}
