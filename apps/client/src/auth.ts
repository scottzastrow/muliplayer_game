import { showStatus } from "./ui.js";

export interface ClientAccount {
  id: string;
  username: string;
  role: "player" | "operator";
}

export async function mountAuth(
  root: HTMLElement,
  status: HTMLElement,
  onAuthenticated: (account: ClientAccount) => void
): Promise<void> {
  const form = document.createElement("form");
  form.className = "auth-form";
  const title = document.createElement("h2");
  const usernameField = makeInput("Username", "username", "text", "username");
  usernameField.input.required = true;
  usernameField.input.minLength = 3;
  usernameField.input.maxLength = 24;
  usernameField.input.pattern = "[A-Za-z0-9_]{3,24}";
  const passwordField = makeInput("Password", "password", "password", "new-password");
  passwordField.input.required = true;
  passwordField.input.maxLength = 128;
  const submit = document.createElement("button");
  submit.type = "submit";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "link-button";

  let registering = false;
  const updateMode = (): void => {
    title.textContent = registering ? "Create an account" : "Sign in";
    submit.textContent = registering ? "Register" : "Sign in";
    toggle.textContent = registering ? "Have an account? Sign in" : "Need an account? Register";
    passwordField.input.autocomplete = registering ? "new-password" : "current-password";
    passwordField.input.minLength = registering ? 9 : 0;
  };
  toggle.addEventListener("click", () => {
    registering = !registering;
    updateMode();
    showStatus(status, "");
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    showStatus(status, "");
    try {
      const response = await fetch(`/api/v1/auth/${registering ? "register" : "login"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          username: usernameField.input.value,
          password: passwordField.input.value
        })
      });
      const result = await readResponse<{ account: ClientAccount }>(response);
      if (registering) {
        registering = false;
        updateMode();
        passwordField.input.value = "";
        showStatus(status, "Account created. Sign in with your new credentials.");
        return;
      }
      onAuthenticated(result.account);
    } catch (error) {
      showStatus(status, error instanceof Error ? error.message : "The request failed.", true);
    } finally {
      submit.disabled = false;
    }
  });
  form.append(
    title,
    usernameField.label,
    usernameField.input,
    passwordField.label,
    passwordField.input,
    submit,
    toggle
  );
  root.replaceChildren(form);
  updateMode();
}

export async function loadCurrentAccount(): Promise<ClientAccount | undefined> {
  const response = await fetch("/api/v1/me", { credentials: "same-origin" });
  if (response.status === 401) {
    return undefined;
  }
  return (await readResponse<{ account: ClientAccount }>(response)).account;
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string"
        ? body.error.message
        : "The request failed.";
    throw new Error(message);
  }
  return body as T;
}

function makeInput(
  labelText: string,
  name: string,
  type: string,
  autocomplete: HTMLInputElement["autocomplete"]
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label");
  label.htmlFor = name;
  label.textContent = labelText;
  const input = document.createElement("input");
  input.id = name;
  input.name = name;
  input.type = type;
  input.autocomplete = autocomplete;
  return { label, input };
}
