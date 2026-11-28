# 外道不覚悟 — FIELD v0.7.0 スキル演出強化

作成日：2026-11-08  
基準版：FIELD v0.6.2（操作性良好として固定したコミット `4cc097c49ec7ccb21a0ab9e4db4d0e43736559d0`）  
実装内容：2026-11-08のMAGEスキルコンセプト画像（SKILL 1 FIREBALL / SKILL 2 SWORD SLASH / SKILL 3 LASER / SKILL 4 CHARGE）の**演出意匠をWebゲーム用の透明SVGテクスチャとCanvasアニメーションに落とし込んだ版**。コンセプトシート画像そのものを背景に貼る方式ではない。

## 追加した視覚効果

| スキル | v0.7.0実装内容 |
|---|---|
| 1 炎弾 | 前方へ突き出した手の前に**金色のルーン魔法陣**が開き、足元に陣が広がる。炎弾にはオレンジ～白金の発光コア、炎の尾、火花が付く。移動硬直なし |
| 2 斬撃 | **紫とシアンの半月状の斬撃軌跡**、追従する剣の残像2枚、破片・光粒。v0.6.2の前方への短距離高速踏み込みと一瞬の硬直を維持 |
| 3 レーザー | キャラクター前面の**紫色の多重ルーン陣**、レーザーの通過位置に3つのゲート状リング、紫・桃・白の多層ビームと粒子。両手を合わせて約0.24秒静止する既存仕様を維持 |
| 4 突撃 | **前傾・左拳の前方に紫と水色の衝撃光**。後方に高速ストリーク・残像の尾、足元の土煙と光粒。スティック・矢印キーで軌道修正する既存機能を維持 |

5つの独立した透明SVGアセット：
- `docs/assets/skill-fire-sigil.svg` — 金色ルーン魔法陣
- `docs/assets/skill-fireball.svg` — 炎弾と尾
- `docs/assets/skill-slash-arc.svg` — 斬撃の紫／シアン三日月
- `docs/assets/skill-laser-glyph.svg` — レーザーの紫色魔法陣
- `docs/assets/skill-charge-aura.svg` — 突撃・拳先の衝撃環

加えたプログラムコンポーネント：`/src/adapters/CinematicSkillFieldRenderer.ts`（`docs/index.html`内のモジュールマップに格納）。`SkillMotionFieldRenderer`から継承し、透明SVGの読み込み、8方向の向き対応、時系列のアニメーション、光粒・残像の描画のみを行う。ロード失敗時には可能な範囲でCanvas描画へフォールバック。

## DIと変更禁止範囲

変更した既存コンポーネントは**`/src/main.ts`の描画実装の注入先1か所のみ**（`SkillMotionFieldRenderer` → `CinematicSkillFieldRenderer`）。

以下は**変更していない**：
- `GameEngine`、基本移動処理、当たり判定、ジャンプ処理
- `JoystickInput`、`KeyboardInput`、`ActionButtons`（iPhoneの移動中スキル発動と2指操作を含む）
- `SkillSystem`、`SkillMotionSystem`、`SkillMotionMovementSystem`（発動タイミング・射程・クールダウン・硬直・突撃操作）
- `RemotePlayerStore`、Firebase接続、セーブ関連の設定
- `field-theme.css`、元の8方向MAGEスプライト、マップ定義

## 検証実績

- 26内蔵モジュールをJavaScriptとして構文チェック。
- 描画アダプタが元のスキルモーション描画から継承していることを確認。
- 8方向×4スキル×2フレーム＝64回の模擬Canvas描画で、各スキルに対応する実アセット使用を確認。
- 模擬描画操作：画像688回、パス1328回、線描画1856回、グラデーション16回（検証時の合計）。
- カメラ処理・マルチプレイヤー描画・プレイヤー位置HUD・マルチタッチ入力の既存コンポーネント維持を確認。
- **実ブラウザ／iPhone実機での見た目とFPSは未確認**。特にiPhoneで4スキルのエフェクトが重ならず、操作を阻害しないことを検証する必要がある。

## 未実装・残課題

- オンラインの他プレイヤーによるスキル発動エフェクトの同期は未実装（遠隔MAGEの位置・向きのみ）。
- 敵・ダメージ判定などの本格的戦闘は未実装。
- SVGとCanvasの併用は試作方式。モバイル端末で性能面に問題があればアセット事前ラスタライズ・エフェクト量の調整を検討。
- Firebase設定は依然として別途必要。

## 復元・差分確認

操作性良好と評価されたv0.6.2は `baseline/field-v0.6.2-good-controls-20261108` ブランチに保管。v0.7.0との比較：
```bash
git fetch origin
git diff 4cc097c49ec7ccb21a0ab9e4db4d0e43736559d0 origin/main -- docs/index.html docs/assets
```
**重要**：描画のみの次回変更では入力・ゲームコア・スキル挙動を改変しないこと。
