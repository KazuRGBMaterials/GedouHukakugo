# システム001 — FIELD v0.6.2 (2026-11-08)

## 改修目的
MAGEをわずかに縮小し、実際の探索可能マップを拡張。スキル1〜4にそれぞれ異なる身体モーションを追加し、スキル2・3に短い移動硬直を付与する。マルチプレイ、入力、既存の攻撃効果は維持する。

## 確定した今回の動作
| 項目 | v0.6.2 |
|---|---|
| キャラ表示 | 従来のフィールド内スプライトの86%。表示上の縮小で、物理当たり判定の半径は既存の15のまま |
| フィールド | 1600×1000。元の1280×800の世界・障害物座標をそのまま広げる。追加領域は現段階では簡素な地形 |
| カメラ | タッチ端末 zoom=1.28（旧1.56）、PC zoom=1.11（旧1.27）。画面内の表示範囲拡大 |
| スキル1 | 前方へ片手を突き出す0.17秒のモーション。移動硬直なし。炎弾の既存効果・0.20秒クールダウンは維持 |
| スキル2 | 剣を構えて斬撃を発射。向いている方向へ680単位/秒×0.095秒（約65単位）の踏み込み。地形との衝突判定あり。直後に0.14秒の移動硬直 |
| スキル3 | 両手を合わせ、レーザー発射時にその場で0.24秒の移動硬直。ポーズ表示時間約0.28秒 |
| スキル4 | 前傾姿勢・左拳を前に出す構え。既存の超高速突撃（約0.44秒）・スティック/矢印キーでの進路修正を維持 |

**今回のモーションは既存の8方向ドット絵に腕・手・剣のピクセル演出を重ねた暫定表現。** 専用の方向別スプライトシートを描き起こしたわけではない。

## 依存性注入・変更範囲
- 新規: `/src/skills/SkillMotionSystem.ts`（既存SkillSystemのデコレーター。モーション・短時間硬直状態を管理）
- 新規: `/src/skills/SkillMotionMovementSystem.ts`（既存AbilityMovementSystemのデコレーター。踏み込み・硬直だけ追加）
- 新規: `/src/adapters/SkillMotionFieldRenderer.ts`（既存MultiplayerFieldRendererの派生。描画、キャラ縮小、拡張エリアの土の道）
- 変更: `/src/main.ts`（DI組み立て、既存WORLDを拡張したfieldWorldを注入）
- 変更: `/src/adapters/CanvasFieldRenderer.ts`（カメラzoom定数のみ）
- 変更: `/src/multiplayer/RemotePlayerStore.ts`（ワールド境界をDI化し、遠隔座標を受け付ける）
- 変更: `docs/assets/multiplayer-room.js`（送信座標上限を動的に参照）
- 変更: `docs/firebase/database.rules.json`（x=1600, y=1000まで許可）

変更していないもの：
`/src/core/MovementSystem.ts`、`/src/core/world.ts`、`/src/core/GameEngine.ts`、`/src/input/KeyboardInput.ts`、`/src/input/JoystickInput.ts`、`/src/actions/ActionButtons.ts`、`/src/actions/ActionState.ts`、`/src/skills/SkillSystem.ts`、`/src/skills/AbilityMovementSystem.ts`、`/src/multiplayer/MultiplayerFieldRenderer.ts`、`docs/assets/firebase-config.js`等。

## テスト
- 25内蔵モジュールのJS構文を検証。
- スキル1の移動継続、スキル2の剣踏み込み・短時間移動停止・再開、スキル3の静止・再開、スキル4の方向修正、ワールド拡張、遠隔座標上限、Firebaseルールをテスト。
- 描画部品を模擬Canvasで8方向×4スキルについて描画（ローカル・遠隔）できることを確認。
- 実機iPhone/PCでの操作・フレームレートは未検証。特にモバイルの連続入力と4人同時描画を試す。

## 注意点
現時点のFirebase Web設定 `docs/assets/firebase-config.js` は未設定（`null`）のため、オンライン4台接続はバックエンド設定後の検証が必要。世界拡張に合わせ、Firebaseコンソールに旧ルールを登録済みの場合は、本版のDBルールを再反映する。

## 次に検証する項目
- [ ] 移動しながらYでスキル1を連続使用可能
- [ ] スキル2の踏み込みが壁を貫通しない
- [ ] スキル2の移動硬直が不自然に長くない
- [ ] スキル3の両手を合わせる姿勢と静止が同期する
- [ ] スキル4の左拳・前傾姿勢が8方向で自然に見える
- [ ] 拡張後の地形で画面外に出られない
- [ ] iPhoneとPCで表示縮小が想定どおり
- [ ] 既存の4スキル切替、移動・ジャンプ・ダッシュ・マルチプレイルームUIが維持
