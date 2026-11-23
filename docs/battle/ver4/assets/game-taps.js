const controls = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), label, summary, [data-game-touch]';
const tapSlop = 8;

export function isGameTouchControl(target) {
  return Boolean(target?.closest?.(controls));
}

export function bindGameTaps(surface) {
  let blankTap = null;
  const stillAtStart = point => point?.identifier === blankTap.identifier
    && Math.hypot(point.clientX - blankTap.clientX, point.clientY - blankTap.clientY) <= tapSlop;

  surface.addEventListener("touchstart", event => {
    blankTap = event.touches.length === 1 && !isGameTouchControl(event.target) ? event.touches[0] : null;
  }, { capture: true, passive: true });

  surface.addEventListener("touchmove", event => {
    if (blankTap && (event.touches.length !== 1 || !stillAtStart(event.touches[0]))) blankTap = null;
  }, { capture: true, passive: true });

  surface.addEventListener("touchend", event => {
    // Cancel taps on inert surfaces while leaving scrolls, pinches and controls to the browser.
    if (blankTap && event.touches.length === 0 && stillAtStart(event.changedTouches[0]) && event.cancelable) {
      event.preventDefault();
    }
    blankTap = null;
  }, { capture: true, passive: false });

  surface.addEventListener("touchcancel", () => { blankTap = null; }, { capture: true, passive: true });
}
