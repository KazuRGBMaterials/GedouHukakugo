# MODKIT v0.1 — コンテンツ分離と5レイヤー描画

## 対象と安全境界

- 開発ブランチ `feature/layered-sprites-modular-content-20261124` 用の追加基盤。
- 既存のFIELD `docs/index.html`、過去のVER1〜VER4保存版、既存キャラ画像・戦闘バランス・セーブ形式は変更しない。
- 主な対象は現在の戦闘 `docs/battle/?grid=1`。他の画面へは段階的に移植する。
- **本番互換モードではMAGE/ヘルオルの従来の単一画像を維持**。試験表示は `docs/battle/?grid=1&layers=demo`（プレイヤーのみ試験用5層絵）。
- ブラウザテスト: `docs/battle/tests/`。ブラウザ実機確認は別途必要。

## モジュールの依存関係

```text
battle.js (composition root / controls)
   ├── content/manifest.js (individual definitions & packs)
   │    └── modkit/definition-registry.js (pure data)
   ├── rules.js (battle mechanics, unchanged decisions by default)
   └── grid-ui.js (receives visualFor, terrainFor)
         └── grid-motion.js (receives visualFor, sprite renderer)
               └── modkit/layered-sprite.js (DOM adapter only)
```

定義はゲーム内の `newBattle` や描画コードを直接 import せず、`id` によるレジストリ参照を行います。実データの読み込み、具体的な実装の選択は `content/manifest.js` が担当します。ゲームロジックをどのファイルに入れたかで挙動が変わる設計にはしません。

## 個別ファイル・複数ファイルの両対応

1キャラ1ファイル:
```js
export default {
  kind: "characters", id: "new-hero", displayName: "新キャラ",
  graphics: {
    mode: "layered", width: 30, height: 42, columns: 4, rows: 2,
    layers: {
      skin: "./content/assets/new-hero/skin.png",
      eyes: "./content/assets/new-hero/eyes.png",
      clothes: "./content/assets/new-hero/clothes.png",
      hair: "./content/assets/new-hero/hair.png",
      accessories: "./content/assets/new-hero/accessories.png"
    }
  }
};
```

1ファイルに複数定義:
```js
export default {
  characters: [{ id: "a", graphics: { mode: "legacy" } }, { id: "b" }],
  enemies: [{ id: "enemy-a", characterId: "a", ai: "standard" }],
  maps: [{ id: "map-a", terrainType: "grassland" }]
};
```

どちらも `content/manifest.js` で明示的に import し、`DEFAULT_PACKS` に渡せます。静的な GitHub Pages では新ファイルを自動検出できないため、**新規ファイルを使うにはマニフェスト登録が必要**です。登録の際に既存の戦闘本体を編集する必要はありません。将来ビルドツールを導入する場合は自動検出に置換できます。

## レイヤー仕様

- 基本順序（奥→手前）: `skin → eyes → clothes → hair → accessories`。
- 全レイヤーが同一サイズの透明スプライトシート（基本4列×2行、8方向）を使う。
- `graphics.order` で順序をキャラごとに変更可能。追加のレイヤー名も許容。
- 方向番号は `0=正面 → 右前 → 右 → 右後 → 背面 → 左後 → 左 → 左前`。方向と画像フレームの対応を `directionFrames` で上書き可能。
- 移動、ジャンプ、攻撃、被弾、死亡などの親スプライトへの変形・アニメーションは5層で共有する。
- 存在しないレイヤーは透明扱い。透明素材がない既存PNGの正確な5層分離は別途素材制作が必要。
- `mode: "legacy"` は以前の1枚絵描画に委譲する。見た目の互換性を維持する。
- 本番で独自アセットを使う際には相対パス（`docs/battle/`を基準）を使う。

## 今後の拡張と未完

- 戦闘のレジストリ接続は完了。マップの地形計算は既存関数の注入で互換維持。
- 敵AI本体の高度な差し替え・マップ物理とオブジェクト挙動の完全な個別化は後続課題。既存のヘルオル特殊AIと慈悲挙動はそのまま。
- FIELD、FIELD EDITORとのコンテンツ基盤統合は別フェーズ。既存のフィールド保存形式を勝手に変更しない。
- 新規マップで未対応の地形タイプを使う場合は専用 terrainProvider の追加または注入が必要。
- GUIからの5層画像編集、アセット自動読み込み、シーンごとの追加ライフサイクル管理は未実装。
