export function bindBattleFullscreen(main, button) {
  let native = false;
  const isExpanded = () => main.classList.contains("battle-expanded");
  const update = expanded => {
    main.classList.toggle("battle-expanded", expanded);
    button.setAttribute("aria-pressed", String(expanded));
    button.textContent = expanded ? "全画面解除" : "全画面";
  };

  button.addEventListener("click", async () => {
    if (isExpanded()) {
      if (document.fullscreenElement === main) {
        try { await document.exitFullscreen(); }
        catch { /* The CSS layout can still return to its original size. */ }
      }
      update(false);
      return;
    }
    update(true);
    if (main.requestFullscreen) {
      try { await main.requestFullscreen(); }
      catch { /* Fill the webpage viewport on browsers without native fullscreen. */ }
    }
  });

  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement === main) native = true;
    else if (native) {
      native = false;
      update(false);
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !document.fullscreenElement) update(false);
  });
}
