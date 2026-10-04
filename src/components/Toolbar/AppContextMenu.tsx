import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

export type MenuItem = {
  label: string;
  action: () => void;
  disabled?: boolean;
};
type Menu = {
  x: number;
  y: number;
  items: MenuItem[];
  restore: HTMLElement | null;
};
const Context = createContext<(event: MouseEvent, items: MenuItem[]) => void>(
  () => {},
);
export const useAppContextMenu = () => useContext(Context);

export default function AppContextMenu({ children }: { children: ReactNode }) {
  const [clipboardError, setClipboardError] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null),
    ref = useRef<HTMLDivElement>(null);
  const close = () => {
    setMenu(null);
    menu?.restore?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target))
        setMenu(null);
    };
    const dismiss = () => setMenu(null);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, []);
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    ref.current.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - box.width - 8))}px`;
    ref.current.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - box.height - 8))}px`;
    ref.current
      .querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
  }, [menu]);
  const open = (event: MouseEvent, items: MenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();
    setClipboardError("");
    const target = event.target instanceof HTMLElement ? event.target : null;
    const input =
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement &&
        ["text", "search", "url", "tel"].includes(target.type))
        ? target
        : null;
    if (input) {
      input.focus();
      const start = input.selectionStart ?? 0,
        end = input.selectionEnd ?? 0;
      items = [
        {
          label: "Copy text",
          disabled: start === end,
          action: () => {
            input.focus();
            input.setSelectionRange(start, end);
            document.execCommand("copy");
          },
        },
        {
          label: "Cut text",
          disabled: start === end || input.readOnly || input.disabled,
          action: () => {
            input.focus();
            input.setSelectionRange(start, end);
            document.execCommand("cut");
          },
        },
        {
          label: "Paste text",
          disabled: input.readOnly || input.disabled,
          action: () => {
            void navigator.clipboard
              .readText()
              .then((text) => {
                if (!input.isConnected) return;
                const setter = Object.getOwnPropertyDescriptor(
                  input instanceof HTMLTextAreaElement
                    ? HTMLTextAreaElement.prototype
                    : HTMLInputElement.prototype,
                  "value",
                )?.set;
                setter?.call(
                  input,
                  input.value.slice(0, start) + text + input.value.slice(end),
                );
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.focus();
                input.setSelectionRange(
                  start + text.length,
                  start + text.length,
                );
              })
              .catch(() =>
                setClipboardError(
                  "Clipboard paste is unavailable. Use Ctrl+V in the text field.",
                ),
              );
          },
        },
        {
          label: "Select all text",
          action: () => {
            input.focus();
            input.select();
          },
        },
        ...items,
      ];
    }
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items,
      restore:
        input ??
        target
          ?.closest<HTMLElement>(".pdf-navigation")
          ?.querySelector<HTMLElement>(".pdf-scroll") ??
        (document.activeElement as HTMLElement | null),
    });
  };
  return (
    <Context.Provider value={open}>
      {children}
      {clipboardError && (
        <div role="status" className="history-feedback">
          {clipboardError}
          <button
            onClick={() => setClipboardError("")}
            aria-label="Dismiss clipboard message"
          >
            ×
          </button>
        </div>
      )}
      {menu && (
        <div
          ref={ref}
          className="app-context-menu"
          role="menu"
          aria-label="PDF Markup actions"
          style={{ left: menu.x, top: menu.y }}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
            if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
              e.preventDefault();
              e.stopPropagation();
              const buttons = [
                ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              ];
              const at = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              buttons[
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? buttons.length - 1
                    : (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                      buttons.length
              ]?.focus();
            }
            if (e.key === "Tab") {
              e.preventDefault();
              close();
            }
          }}
        >
          {menu.items.map((item, i) => (
            <button
              key={i}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                close();
                item.action();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </Context.Provider>
  );
}
