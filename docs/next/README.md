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
- 5層試験素材は `docs/battle/content/assets/layered-demo/{skin,eyes,clothes,hair,accessories}.svg` を共用。
- FIELDは元のゲームコアを再利用し、TexturedRendererの描画ポートだけ差し替え。
- BATTLEは従来のrules、タイムライン、AI、各種コントロールを共有し、新しいbattle.jsからキャラ描画/定義を注入。
- EDITORは元の編集・Undo/Redo・JSON処理を引き継ぎ、レジストリに登録されたマップ/オブジェクトをGUIから選択できるようにした。

## 既知の制限

- **5層画像は現時点では専用の仮グラフィック**。既存MAGE/ヘルオルのオリジナル画像を自動分解したわけではない。BATTLE NEXTの切替で従来描画へ戻せる。FIELD NEXTでも従来描画を選択可能。
- 全機能を独立モジュール化したわけではなく、FIELDの旧来型JavaScriptバンドル内部・既存戦闘ルールは再利用している。
- オブジェクトの`definitionId`はEDITOR NEXTのJSONに保存される。元版との互換用`type`も保持する。装備・AI・新しいオブジェクトの行動ロジックまで完全自動生成されるわけではない。
- BATTLE NEXTのグリッドには5層キャラが標準適用。ヘルオルは専用の従来画像のまま。
- 元の現行版・旧保存データを自動的に書き換えない。
- 実機でのタッチ・音声・セーブ復元・画面表示の手動回帰テストは必要。
- メインゲームの移動・衝突・スキル・音声・セーブ動作を横断して全面変更するのではなく、描画/データロードのポートを注入する限定的な改修である。
