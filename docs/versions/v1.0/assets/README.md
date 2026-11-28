# FIELD v0.4.3 — Visual assets

This folder contains independent art/presentation assets. `mage-8dir.png` is a reduced, palette-optimized sheet from the conversation's generated original MAGE artwork (4 columns × 2 rows, each frame 40 × 56 px).

Directions, 0–7: S, SE, E, NE, N, NW, W, SW. The renderer draws a single frame per direction, with no artificial rotation. `ground.svg`, `path.svg`, `stone.svg`, `water.svg` are tileable procedural SVG patterns; `tree.svg`, `chest.svg`, `torch.svg` are independent object illustrations. `field-theme.css` is presentation-only.

`docs/index.html` embeds a JS module table. Only the composition-root wiring (`/src/main.ts`) changed among the existing 16 modules. New rendering adapter `/src/adapters/TexturedFieldRenderer.ts` extends the existing renderer and degrades gracefully while assets load. Game core, collisions, spawn, input, actions, and fullscreen remain unchanged.

HP/MP and level shown in the UI are **placeholder values**, not persistence or gameplay state.

To update character artwork later, replace `mage-8dir.png` with a 4×2 sprite sheet preserving the 40×56 cell contract, or change only the renderer's frame size values. Run eight-direction movement, jump, dash, menu, L/R skill switch, touchscreen and fullscreen regression tests before deploying.
