// Shared defaults; individual definitions override only the fields they need.
export const contentBases = Object.freeze({
  characters: {
    displayName: "",
    graphics: { mode: "legacy", width: 30, height: 42, columns: 4, rows: 2 }
  },
  enemies: {
    characterId: "mage",
    ai: "standard",
    tactics: "standard",
    displayName: "敵"
  },
  maps: {
    displayName: "無題のマップ",
    terrainType: "mixed"
  }
});
