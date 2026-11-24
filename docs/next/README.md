# 外道不覚悟 NEXT v1.0 / 2026-11-24

## 3つの公開予定の入口

- FIELD NEXT: `/GedouHukakugo/next/`
- BATTLE NEXT: `/GedouHukakugo/next/battle/?grid=1`
- FIELD EDITOR NEXT: `/GedouHukakugo/next/editor/`

同じ公開サイトの**現行版** `/`, `/battle/`, `/editor/` は書き換えない。元の3画面は保持。

## 新旧データの安全境界

- FIELD NEXTメイン: `gedo-next-field-save-v1`
- FIELD NEXTエディタ試遊: `gedo-next-field-editor-preview-save-v1`
- EDITOR NEXT: `gedo-next-field-editor-autosave-v1`
- 従来の `gedo-field-save-v1`, `gedo-field-editor-preview-save-v1`, `gedo-field-editor-autosave-v1` には書き込まない。
- エディタはNEXT保存が空なら旧版のマップJSONを**読み取りのみ**で初期値として引き継ぎ、次版の別スロットに保存する。
- 複数ブラウザ・端末間の自動同期はない。JSONのエクスポート・インポートで引き継ぐ。

## 5レイヤーとDI

- `docs/shared/modkit/definition-registry.js` が純粋なデータ登録基盤（characters, enemies, maps, objects）
- `docs/shared/modkit/layered-sprite.js` がDOM描画
- `docs/shared/modkit/layered-canvas.js` がCanvas描画
- `docs/next/content/index.js` が一括組立。各キャラ/マップ/オブジェクトは別のファイルを持ち、複数定義1ファイルにも対応
- 実際のMAGE画像 `docs/assets/mage-8dir.png` (160×112, 8方向, 40×56/方向)を基に、`docs/next/content/assets/mage-layers/{skin,eyes,clothes,hair,accessories}.svg` の5層へ分割。各SVGは元画像のピクセルを領域マスクで切り分けたもので、5枚を重ねると元MAGEの見た目を再構成する。髪/肌/目などのマスク領域は初期分類なので、部位交換用の精細な境界調整は別作業。
- FIELDは元のゲームコアを再利用し、TexturedRendererの描画ポートだけ差し替え。
- BATTLEは従来のrules、タイムライン、AI、各種コントロールを共有し、新しいbattle.jsからキャラ描画/定義を注入。
- EDITORは元の編集・Undo/Redo・JSON処理を引き継ぎ、レジストリに登録されたマップ/オブジェクトをGUIから選択できるようにした。

## 既知の制限

- **MAGEは元の8方向のドット絵に基づく5層画像へ変更**。仮の青いキャラは通常のMAGE表示に使用しない。ジャンプ・空中斬り・地上の描画は同じMAGEの5層定義を共有。5層SVGのロード前も元のMAGE画像を暫定表示する。BATTLE NEXT/ FIELD NEXTとも従来描画への切替を維持。ヘルオルは専用画像のまま。
- 全機能を独立モジュール化したわけではなく、FIELDの旧来型JavaScriptバンドル内部・既存戦闘ルールは再利用している。
- オブジェクトの`definitionId`はEDITOR NEXTのJSONに保存される。元版との互換用`type`も保持する。装備・AI・新しいオブジェクトの行動ロジックまで完全自動生成されるわけではない。
- BATTLE NEXTの味方グリッドには原画5層MAGEを標準適用。仮の`layered-demo`はキャラ選択から除外。ヘルオルは専用の従来画像のまま。
- 元の現行版・旧保存データを自動的に書き換えない。
- 実機でのタッチ・音声・セーブ復元・画面表示の手動回帰テストは必要。
- メインゲームの移動・衝突・スキル・音声・セーブ動作を横断して全面変更するのではなく、描画/データロードのポートを注入する限定的な改修である。
