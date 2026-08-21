"use client";

import { useEffect, useRef } from "react";

const filters = [
  ["all", "All tips"],
  ["monthly", "Monthly checks"],
  ["service", "Service time"],
  ["seasonal", "Seasonal care"],
  ["warning", "Warning signs"],
] as const;

export function CarCareTips() {
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const buttons = Array.from(
      toolbar.querySelectorAll<HTMLButtonElement>("[data-tip-filter]"),
    );
    const tips = Array.from(
      document.querySelectorAll<HTMLDetailsElement>("[data-tip-groups]"),
    );
    const status = toolbar.querySelector<HTMLElement>("[data-tip-status]");

    toolbar.hidden = false;

    const listeners = buttons.map((button) => {
      const listener = () => {
        const filter = button.dataset.tipFilter;
        let visible = 0;

        for (const candidate of buttons) {
          candidate.setAttribute(
            "aria-pressed",
            String(candidate === button),
          );
        }

        for (const tip of tips) {
          const groups = (tip.dataset.tipGroups ?? "").split(" ");
          const matches = filter === "all" || groups.includes(filter ?? "");
          tip.hidden = !matches;
          if (!matches) tip.open = false;
          if (matches) visible += 1;
        }

        if (status) {
          status.textContent = `${visible} ${visible === 1 ? "tip" : "tips"} shown`;
        }
      };

      button.addEventListener("click", listener);
      return [button, listener] as const;
    });

    return () => {
      for (const [button, listener] of listeners) {
        button.removeEventListener("click", listener);
      }
    };
  }, []);

  return (
    <div className="tip-toolbar" data-tip-toolbar hidden ref={toolbarRef}>
      <div>
        <p className="tip-toolbar-label">Show tips for</p>
        <div className="tip-filters" role="group" aria-label="Filter car care tips">
          {filters.map(([value, label], index) => (
            <button
              key={value}
              type="button"
              data-tip-filter={value}
              aria-pressed={index === 0}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="tip-filter-status" data-tip-status aria-live="polite">
        13 tips shown
      </p>
    </div>
  );
}
