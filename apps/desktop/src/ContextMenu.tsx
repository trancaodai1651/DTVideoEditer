import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export type MenuItem =
  | { label: string; shortcut?: string; disabled?: boolean; danger?: boolean; checked?: boolean; action: () => void }
  | { heading: string }
  | "separator";

export interface MenuState { x: number; y: number; items: MenuItem[]; label: string }

const actionable = (item: MenuItem): item is Extract<MenuItem, { action: () => void }> =>
  typeof item === "object" && "action" in item && !item.disabled;

/** A right-click menu kept inside the window. Arrow keys move, Enter runs, Escape closes. */
export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: menu.x, top: menu.y });

  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(menu.x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(menu.y, window.innerHeight - height - 4)),
    });
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [menu]);

  useEffect(() => {
    const close = (event: Event) => {
      if (event.target instanceof Node && list.current?.contains(event.target)) return;
      onClose();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("keydown", escape);
    };
  }, [onClose]);

  function keys(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  return <div className="context-menu" role="menu" aria-label={menu.label} ref={list} style={position}
    onKeyDown={keys} onContextMenu={(event) => event.preventDefault()}>
    {menu.items.map((item, index) => {
      if (item === "separator") return <div key={index} className="context-separator" role="separator" />;
      if ("heading" in item) return <div key={index} className="context-heading">{item.heading}</div>;
      return <button key={index} type="button" role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
        aria-checked={item.checked} disabled={item.disabled} className={item.danger ? "danger" : undefined}
        onClick={() => { if (!actionable(item)) return; onClose(); item.action(); }}>
        <span className="context-check" aria-hidden="true">{item.checked ? "✓" : ""}</span>
        <span>{item.label}</span>
        {item.shortcut && <kbd>{item.shortcut}</kbd>}
      </button>;
    })}
  </div>;
}
