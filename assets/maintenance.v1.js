const toolbar = document.querySelector("[data-tip-toolbar]");

if (toolbar) {
  const buttons = [...toolbar.querySelectorAll("[data-tip-filter]")];
  const tips = [...document.querySelectorAll("[data-tip-groups]")];
  const status = toolbar.querySelector("[data-tip-status]");

  toolbar.hidden = false;

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const filter = button.dataset.tipFilter;
      let visible = 0;

      for (const candidate of buttons) {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      }

      for (const tip of tips) {
        const groups = tip.dataset.tipGroups.split(" ");
        const matches = filter === "all" || groups.includes(filter);
        tip.hidden = !matches;
        if (!matches) tip.open = false;
        if (matches) visible += 1;
      }

      status.textContent = `${visible} ${visible === 1 ? "tip" : "tips"} shown`;
    });
  }
}
