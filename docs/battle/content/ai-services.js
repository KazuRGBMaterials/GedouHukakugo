/**
 * AI composition boundary. Enemy definitions contain only strategy IDs;
 * specific AI implementations are selected here and injected into the rules.
 */
import { chooseEnemyAction } from "../grid-ai.js?v=5";
import { chooseHellorAction } from "../hellor-ai.js?v=1";
import { chooseEnemyTactic } from "../grid-tactics.js?v=2";

export function createBattleAI({
  standard = chooseEnemyAction, hellor = chooseHellorAction,
  tactic = chooseEnemyTactic, extensions = {}
} = {}) {
  return Object.freeze({
    forEnemy(definition) {
      const id = definition?.ai || "standard";
      const selected = id === "hellor" ? hellor : extensions[id] || standard;
      return Object.freeze({ regular: selected, boss: selected, tactic });
    }
  });
}
