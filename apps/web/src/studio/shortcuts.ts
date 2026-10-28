export interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

function isTextEntry(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  return target instanceof HTMLInputElement && target.type !== "range" && target.type !== "checkbox" && target.type !== "button";
}

export function historyShortcut(event: ShortcutEvent): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || isTextEntry(event.target)) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (key === "z") {
    return event.shiftKey ? "redo" : "undo";
  }
  return key === "y" && event.ctrlKey && !event.shiftKey ? "redo" : null;
}
