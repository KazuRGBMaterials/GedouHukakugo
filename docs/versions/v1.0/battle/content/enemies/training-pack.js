// Multiple enemy types in one file: same interface as 1-enemy/1-file.
export default {
  enemies: [
    { id: "default", displayName: "訓練用の見張り", characterId: "mage",
      ai: "standard", tactics: "standard", battleType: "default" },
    { id: "hellor", displayName: "ヘルオル", characterId: "hellor",
      ai: "hellor", tactics: "optimal", battleType: "hellor" }
  ]
};
