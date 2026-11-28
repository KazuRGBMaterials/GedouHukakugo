# 外道不覚悟 / システム001 FIELD v0.5.0 — 2026-11-08

## Change policy
- Three **new injected components** are added as independent entries in the inline module map in `docs/index.html`:
  - `/src/skills/SkillSystem.ts`: skill state, cooldown, projectile/beam/charge model, world hit checks.
  - `/src/skills/AbilityMovementSystem.ts`: wraps existing movement and collision implementation, airborne wall phasing, safe landing, steerable charge.
  - `/src/adapters/AbilityFieldRenderer.ts`: new texture-based visual subclass, three-pose walk animation and effects.
- The only three existing **embedded** modules changed are `main.ts` (DI composition root), `ActionButtons.ts` (dispatch to skills), `ActionState.ts` (4 skills instead of 3).
- Existing `GameEngine`, `MovementSystem`, `DashMovementSystem`, `KeyboardInput`, `JoystickInput`, `JumpRenderer`, `TexturedFieldRenderer`, `world.ts` **remain unchanged**.
- The `docs/assets/` textures and 8-facing MAGE image are **unchanged**. The character is scaled from approx 68x95 to 42x59 world units.
- The three movement poses are *procedurally composited* from the existing 8-direction image, by changing foot and upper-body offsets in three frames. This is a lightweight animation prototype, not 24 separately hand-painted poses.

## Skill control
- On-screen Y / keyboard A = use current skill.
- L/R / keyboard Q/W = select skills 1–4 cyclically.
- Skill 1: fireball projectile, 560 world units/sec, hits obstacles or map border.
- Skill 2: short-range moving crescent slash, 390 units/sec.
- Skill 3: forward laser lasting 0.36 sec, blocked by obstacles.
- Skill 4: forward charge, 950 units/sec for 0.44 sec; directional stick / arrow input turns up to approx 5.3 radians/sec.
- In-flight jump (B / keyboard Z) phases through **stone walls only**, not trees, pond, boxes, nor map bounds. Upon landing inside a wall, the movement adapter finds a nearby valid spot or falls back to the previous grounded safe position.
- All skill graphics are **visual prototypes**, with no enemy HP/damage system yet.
- The character HUD shows placeholder HP/MP and level; no save integration is claimed.

## Regression checks already executed
- Four skill initiation paths and forward vectors.
- Traveling fire projectile; independent slash and laser.
- Four skill slots / L–R wraparound.
- Steering during ongoing high-speed charge.
- Normal wall collision preserved while airborne wall crossing succeeds.
- Grounded landing is safe.
- Three distinct walk poses using NW-facing MAGE sprite.
- Touch Y/L/R, keyboard A/Z/S/X/Q/W, and UI reset.
- Rendering API of visual effects, syntax of bundled JS.
- **Browser/device interaction remains to be verified**. Specifically check on iPhone Safari, Windows keyboard, landscape/portrait and fullscreen.

## Manual smoke test
1. On iPhone and PC, move in all eight directions. Sprite should face the input direction, be smaller than v0.4.3 and cycle three stepping poses.
2. Stand against a stone wall. Walk should be blocked; jumping B/Z while moving should allow crossing it.
3. Use L/R to select skills 1→2→3→4→1, press Y/A for each, and verify fireball, crescent slash, laser and rush.
4. During the rush, steer the joystick or arrow keys and confirm the path bends, without passing through walls.
5. Confirm dash double-tap, menu, reset, smooth mobile joystick and fullscreen work as before.

## Restrictions on future AI changes
Before any feature change, declare an allowlist of files and list explicit no-change files. Never rewrite the gameplay core, input, or collision rules while only adjusting visuals. Do not silently change skill slot numbering or key mappings.
