// Battlefield scenery is visual-only: it does not affect movement, cost or damage.
const mixed = [
  ["grass", "grass", "grass", "rubble", "ruins"],
  ["grass", "grass", "rubble", "ruins", "ruins"],
  ["grass", "grass", "rubble", "rubble", "ruins"],
  ["grass", "grass", "grass", "rubble", "ruins"],
  ["grass", "grass", "rubble", "ruins", "ruins"]
];
export const TERRAIN_SCENES = Object.freeze(["mixed", "grassland", "ruins"]);

export function terrainAt(x, y, scene = "mixed") {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return "grass";
  if (scene === "grassland") return "grass";
  if (scene === "ruins") return (x * 7 + y * 3) % 4 === 0 ? "rubble" : "ruins";
  return mixed[y % mixed.length][(x + Math.floor(y / mixed.length) * 2) % mixed[0].length];
}
