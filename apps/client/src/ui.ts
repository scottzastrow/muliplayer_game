export function showStatus(status: HTMLElement, message: string, isError = false): void {
  status.textContent = message;
  status.setAttribute("role", isError ? "alert" : "status");
  status.setAttribute("aria-live", isError ? "assertive" : "polite");
}
