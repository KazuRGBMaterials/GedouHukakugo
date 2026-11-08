# 外道不覚悟 — FIELD v0.6.2 基準版（操作性良好）

> 保存日：2026-11-08（日本時間）  
> **ユーザー評価：**「かなり操作性はよく今の状態を後から追えるように記録保存して」  
> **位置づけ：** 操作感に満足した時点を後から検証・比較・復元できるようにするベースライン。  
> **注意：** 上記はユーザーの操作感の評価であり、全端末・全機能の動作保証を意味しない。

## 1. 復元可能なソースの固定情報

| 項目 | 値 |
|---|---|
| リポジトリ | `KazuRGBMaterials/GedouHukakugo` |
| 保存対象 | FIELD v0.6.2 |
| **固定コミット（変更しない）** | `4cc097c49ec7ccb21a0ab9e4db4d0e43736559d0` |
| **基準版ブランチ** | `baseline/field-v0.6.2-good-controls-20261108` |
| HTML（コミット時点のblob SHA） | `428657e95c52c7b5d7995652dfa7c10efc76998e` |
| 実行ファイルの位置 | `docs/index.html` |
| GitHub Pages公開先 | https://kazurgbmaterials.github.io/GedouHukakugo/ |
| GitHub Pagesデプロイ | 上記コミットに対応するActions実行が **success**（2026-11-08） |
| 内蔵JSモジュール | 25個（`docs/index.html` の `modules` マップに格納） |
| 保存対象 | 本コミットの**リポジトリ全体**。HTML/CSS/JS、MAGE画像、テクスチャ、Firebase用ファイル、既存仕様書を含む |

### 固定版へのリンク

- 基準版ブランチ： https://github.com/KazuRGBMaterials/GedouHukakugo/tree/baseline/field-v0.6.2-good-controls-20261108
- 固定コミット： https://github.com/KazuRGBMaterials/GedouHukakugo/commit/4cc097c49ec7ccb21a0ab9e4db4d0e43736559d0
- 固定版HTML： https://github.com/KazuRGBMaterials/GedouHukakugo/blob/4cc097c49ec7ccb21a0ab9e4db4d0e43736559d0/docs/index.html
- 当時の仕様書： https://github.com/KazuRGBMaterials/GedouHukakugo/blob/4cc097c49ec7ccb21a0ab9e4db4d0e43736559d0/docs/FIELD_v0.6.2_SKILL_MOTIONS.md

**重要：** GitHub Pagesの通常URLは将来の更新に追従する。過去版を厳密に参照する場合は、上記固定コミットまたは基準版ブランチを使うこと。

## 2. 2026-11-08現在、良好と評価された操作・体験

- PC・スマホ・タブレット向けWebブラウザゲーム。Windowsで開発し、スマートフォンやタブレットで操作する構想。
- MAGEの8方向ドット絵と3種類の移動ポーズ。v0.6.1からのフィールド表示サイズ約86%。
- マップは1600×1000。既存地形の座標は維持して、外周を拡張。カメラzoomはタッチ1.28、PC1.11。
- 移動：PC矢印キー（2回押しでダッシュ）、スマートフォンの左仮想スティック（外周でダッシュ）。
- 移動中も右手のYボタンでスキル発動可能となるよう、v0.6.1でマルチタッチ対応を実装済み。
- ボタン割当：画面Y＝スキル、B＝ジャンプ、X＝メニュー、A＝決定、L/R＝スキル切替。
- PCキー：A＝スキル、Z＝ジャンプ、S＝メニュー、X＝決定、Q/W＝前/次スキル。
- ジャンプ中は**石壁**を通過可能（木・水辺・木箱・外周は対象外）。着地時の位置補正あり。
- スキル1（炎弾）：手を前に出す0.17秒のモーション。**移動硬直なし**。炎弾が前方に飛ぶ。
- スキル2（斬撃）：剣を構え、前方に斬撃を出しながら約65座標単位の短距離高速踏み込み。直後約0.14秒の硬直。
- スキル3（レーザー）：両手を合わせて静止し発動。約0.24秒の移動硬直。
- スキル4（突撃）：前傾姿勢で左拳を突き出して前方へ超高速突撃。移動スティック・矢印キーによる方向修正可能。
- キャラクターモーションは既存8方向MAGE画像に腕・剣などの描画を重ねる暫定実装（手描き24コマ画像ではない）。

## 3. システム構造と変更保護

原則：**小さく動くWebゲームに独立コンポーネントを積み重ね、依存性注入（DI）を維持する。AIは指示した範囲以外を変更しない。**

- `/src/main.ts`（内蔵モジュール）：Composition Root。依存関係の結線と拡張ワールド注入。
- `/src/core/GameEngine.ts`、`MovementSystem.ts`：ループ・移動・基本衝突判定。
- `/src/input/KeyboardInput.ts`、`JoystickInput.ts`、`CombinedInput.ts`：入力受付。
- `/src/actions/ActionButtons.ts`：ボタンのクリック／タッチイベント。
- `/src/skills/SkillSystem.ts`：攻撃効果モデル（既存）。
- `/src/skills/SkillMotionSystem.ts`：スキル姿勢・一瞬の硬直を独立管理するデコレーター。
- `/src/skills/AbilityMovementSystem.ts`：ジャンプ時の壁抜け・突撃の方向制御。
- `/src/skills/SkillMotionMovementSystem.ts`：斬撃踏み込み・硬直処理を独立追加したデコレーター。
- `/src/adapters/CanvasFieldRenderer.ts`：カメラの倍率。
- `/src/adapters/SkillMotionFieldRenderer.ts`：MAGEの縮小、4種ポーズ、マップ追加部分の描画。
- `/src/multiplayer/RemotePlayerStore.ts`、`MultiplayerFieldRenderer.ts`：遠隔プレイヤーの座標管理・表示。
- `docs/assets/`：独立したキャラ画像／地面・水・樹木等のテクスチャとCSS。
- `docs/assets/multiplayer-room.js` と `docs/firebase/database.rules.json`：将来のFirebaseリアルタイム同期向け。

**改修ルール：** 新機能では、対象モジュール／変更してよいファイルと、変更禁止ファイルを事前に明示する。変更前の固定コミットを参照し、変更後は入力・スキル・移動・描画・マルチタッチの回帰テストを実施する。固定ブランチには通常の開発コミットを積み重ねない。

## 4. 検証済み／未検証を分ける

### これまでに確認できたこと

- モジュール構文確認およびスキル・移動・短時間硬直・衝突判定等の模擬テスト：v0.6.2実装時に19項目合格。
- 8方向×4スキルの描画経路：模擬Canvas上のテスト合格。
- v0.6.1の移動しながらY/B/L/R操作するマルチタッチ模擬テスト：15項目合格。
- GitHub Pages：v0.6.2に対応するActionsデプロイ成功。
- **今回のユーザー評価：操作性は「かなりよい」。** この評価を次版との比較の基準にする。

### 未完了・注意事項

- 実機での各スキル動作・FPS・4端末同時接続を網羅的に検証した記録はない。
- `docs/assets/firebase-config.js` はこの基準版では `firebaseConfig = null` のまま。ルームUIやネットワーク通信のコードは存在するが、Firebase接続設定完了前は**オンライン4人同時プレイ不可**。
- 敵へのダメージ・HP/MPの実システム・オンラインスキル効果・セーブ連携は未完成。ステータスUIには仮数値あり。
- 実キャラクターの見た目の縮小に対して、物理当たり判定半径（15）は変更していない。
- Firebaseのルールを既に登録済みの場合は、拡張マップの座標範囲x=1600／y=1000に更新する必要あり。

## 5. この状態へ戻す・比較する方法

### 安全な確認（現在のmainを変えない）
```bash
git fetch origin
git switch -c check-field-v0.6.2 origin/baseline/field-v0.6.2-good-controls-20261108
```

### 今後の版との差分確認
```bash
git diff 4cc097c49ec7ccb21a0ab9e4db4d0e43736559d0 origin/main -- docs/index.html docs/assets docs/firebase
```

ローカルにこのリポジトリを初めて取得するときは `git clone https://github.com/KazuRGBMaterials/GedouHukakugo.git` で取得する。

**注意：** 上記の比較・確認コマンドはmainを上書きしない。現行のmainへ実際に復元する場合は別ブランチで差分確認し、レビューした変更だけを取り込むこと。未コミットのローカル編集がある場合は必ず退避してからブランチ操作する。

## 6. 引継ぎ先AIへの最初の指示例

「『外道不覚悟』のFIELD開発を再開する。まず本ファイルと固定コミット `4cc097c49ec7ccb21a0ab9e4db4d0e43736559d0` を参照せよ。これは操作性良好と評価された基準版。指定していないファイルや操作割当を変更するな。今から追加する機能について、変更許可領域・変更禁止領域・既存動作の回帰試験を最初に提示せよ。Firebaseの未設定部分を動作済み扱いしないこと。」

---
保存目的：単なる会話要約ではなく、後日戻せる**具体的なGitコミット／ブランチと、その時の仕様・評価・未完了事項を対応づけること**。
