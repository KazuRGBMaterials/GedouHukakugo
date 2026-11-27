# 『外道不覚悟』NEXT — Firestore＋Realtime Database併用 v0.2

更新：2026-11-28。**v0.1（Realtime Databaseへの一括保存）から新方式へ切替。**
ソースコード：`docs/next/cloud/`、`docs/next/online/`、`docs/firebase/`。

## 1. 基本方針と保存の分担

| 対象 | 保存先 | データ領域 | 保存頻度 |
|---|---|---|---|
| FIELD NEXTの位置・向き・選択スキル | **Cloud Firestore** | `cloudSaves/{auth.uid}/slots/field-main` | ボタン操作、任意30秒差分自動保存 |
| FIELDのEDITOR試遊セーブ | Cloud Firestore | `.../slots/field-preview` | 同上 |
| EDITOR NEXTのマップ | Cloud Firestore | `.../slots/editor-map` | ボタン操作、任意30秒差分自動保存 |
| BATTLE NEXTの対戦設定 | Cloud Firestore | `.../slots/battle-setup` | ボタン操作、任意30秒差分自動保存 |
| FIELD NEXTの他プレイヤー表示 | **Realtime Database** | `rooms/{8文字コード}/players` | 動いたとき最大約8回/秒 |
| ONLINE NEXTのルーム・操作・対戦状態 | Realtime Database | `arenaRooms/{12文字コード}/...` | ホスト約320ms、入力約300ms |

Authは**共通のFirebase Authentication匿名UID**。個人セーブはルーム参加者から読めない。匿名UIDはブラウザごとに異なり、単にルームへ入っただけで個人セーブの共有・移管はされない。別端末への引継ぎはJSON書出し・取込みを使う。Google/メール連携と期限付き引継ぎコードは未実装。

地域の推奨（未作成なら）：**Firestore (default) は東京 `asia-northeast1`、Realtime Databaseはシンガポール `asia-southeast1`**。Firebase公式によるとこれらのサービスの地域は独立。選択時に地域を確認すること。

**重要：実際のRealtime Database URLはユーザーから受領済みです。** `https://gedouhukakugo-default-rtdb.asia-southeast1.firebasedatabase.app/` を公開設定の `verifiedRealtimeDatabaseURL` に記録しました。Firebaseコンソールで匿名認証と正しいRTDBルールが公開されたと確認できるまでは `databaseURL: null` の安全ゲートを維持し、オンラインルームを無効にします。一方、FirestoreはWebアプリ設定があるためFirebase ConsoleでFirestoreと匿名認証および正しいRulesを設定後に利用できる。

## 2. Firebase Consoleでのセットアップ（Spark無料プランのまま）

1. [プロジェクト概要](https://console.firebase.google.com/project/gedouhukakugo/overview)で現在のプランが**Spark（無料）**であることを確認。不要な請求先アカウント連携はしない。Firebase Consoleには管理者としてログインして操作する。
2. [Authentication](https://console.firebase.google.com/project/gedouhukakugo/authentication/providers) > ログイン方法 > 「匿名」を**有効にする**。ユーザーはゲームでクラウド機能を押したときだけ匿名サインインする。
3. [Cloud Firestore](https://console.firebase.google.com/project/gedouhukakugo/firestore) > データベース作成。**Standardエディション、デフォルトDB `(default)`、東京 `asia-northeast1`、本番/ロック（限定的なルール）モード**を選ぶ。すでに作成済みなら変更不要。**この段階で自由な読み書きを許可する「テストモード」にしない。**
4. Firestoreの**「ルール」タブ**で [`docs/firebase/firestore.rules`](../../firebase/firestore.rules) の全文を登録して **「公開」**。このルールは `cloudSaves/{uid}/slots/{slot}` の本人アクセスと厳密な型/サイズ/リビジョンを制限。**JSONではなくFirestore Rules言語**。
5. [Realtime Database](https://console.firebase.google.com/project/gedouhukakugo/database) を作成。**シンガポール、ロックモード**（選択できる場合）。既存作成済みならその地域を尊重する。
6. Realtime Databaseの**「ルール」タブ**で [`docs/firebase/database.rules.json`](../../firebase/database.rules.json) の全文を登録して **「公開」**。このファイルは**JSON**であり、Firestoreのルールとは別。相互に貼り間違えない。

   **2026-11-28 修正:** 初版に誤って含まれた `numChildren()` はRealtime Database **Security Rulesでは使用できない**ため、公式の `hasChildren([...])` と各フィールドの明示的な `.validate` および `$other: {".validate": false}` に置き換えた。Firebase Consoleの「ルール」へ必ず **更新後のmain版全文** を貼る。古いコードの貼り付けや、一部行だけの修正はしない。

   **制約:** ルール内で `numChildren()` に依存していた参加人数4名の**DB側の厳密な人数制限は現時点では実装できていない**。ホストのゲーム処理では最大4名のみシミュレーションするが、5人目の入室データの登録まで防げるわけではない。厳密な上限は固定4スロット方式へのルーム設計変更で別途対応する。
7. Realtime Databaseの**実際のURLは受領・記録済み**。コンソールで **匿名認証とRTDBルールを公開したことを確認できたら** `docs/assets/firebase-config.js` の `databaseURL: null` を、記録済みの `verifiedRealtimeDatabaseURL` と同じURLへ変更する。GitHub PR → CI成功 → mainへマージ → Pagesへ反映。管理者鍵は不要。
8. GitHub Pages [FIELD NEXT](https://kazurgbmaterials.github.io/GedouHukakugo/next/) > Xメニュー >「Cloud Firestore保存」を開き、「クラウド利用を有効にする」でゲストサインイン → セーブ → 読込を検証。途中でセーブ競合になる場合は新しいデータを確認して再読み込みする。
9. 同じURLを2台の異なる端末で開き、[ONLINE NEXT](https://kazurgbmaterials.github.io/GedouHukakugo/next/online/) でルーム作成・招待コード参加・位置/コマンド/協力/対戦状態を確認する。

### なぜ今はFirestoreだけ接続可能にするのか

`docs/next/cloud/firebase-service.js` はサービス別の遅延ロード方式。ゲーム起動直後にはどちらのSDKも認証も動かない。クラウド保存ボタンからは `connect('firestore')`、ONLINEからは `connect('realtime')` を呼ぶ。後者は `databaseURL` 未確認の場合、**SDKを読み込む前に停止**する。ユーザーがオンラインを選ばない限り、勝手にクラウドへ進行を送信しない。

## 3. 既存コードへの影響

| 変更ファイル | 変更内容 |
|---|---|
| `docs/next/cloud/firebase-service.js` | Firebase Authを共通化し、Firestore/Realtime Databaseの接続を分岐 |
| `docs/next/cloud/save-store.js` | Realtime Databaseトランザクションを**Firestoreトランザクション**に置換 |
| `docs/next/cloud/save-panel.js` | Firestore利用と明示したUI。保存・読込・削除・バックアップ操作は維持 |
| `docs/next/online/online.js` | 対戦/協力は明示的にRealtime Databaseへ接続。URL未設定なら無効表示 |
| `docs/firebase/firestore.rules` | 新規。個人セーブの認可、サイズ・形式・世代を検証 |
| `.github/workflows/next-system-check.yml` | Firestoreルールの変更時も自動検証 |
| `docs/next/tests/firebase-node.mjs` | Firestoreトランザクション・匿名認証・アクセス境界の回帰テスト |

**変更しない：** `docs/next/index.html` のゲームエンジン、`docs/next/battle/battle.js` の戦闘ルール、`docs/next/editor/editor.js` の編集コア、旧版 `docs/index.html`・`docs/battle/**`・`docs/editor/**`、既存の端末内セーブ。オンラインアリーナのホスト・入力の同期ルールはそのまま。

旧 `docs/firebase/database.rules.json` の `cloudSaves` は過去のRTDB保存版と互換性維持のため残す。ただし**新しいWebクライアントのセーブはFirestoreのみに書き込み**、古いRTDBセーブが存在しても自動移行しない。移行が必要になった場合はバックアップと確認付きで別途実装する。

## 4. データの安全性・コスト

- Firestore保存：`schemaVersion`、`slotId`、`revision`、`deviceId`、`updatedAt`、`payload` を保持。最大200,000バイト。トランザクションは**先にドキュメントを読み**、競合やオフラインでは勝手に上書きせずエラー。
- Firestoreルール：UID本人以外のget/書込み/削除を拒否。コレクションのlistは禁止。**Firestore RulesはRealtime Database Rulesとは別の画面で公開する必要あり**。
- Realtime Database：ルームの参加者による操作とホストによる状態の書込みだけに制限。ルームコードを知る人が入れる設計は継続。完全な対戦チート防止は未実装。
- 小規模・Spark無料プラン運用を基本とする。Firestoreはドキュメントread/write回数、Realtime Databaseは通信量・保存量・接続数を主に監視する。**両方使うことで必ず無料になるとは限らない**（利用枠内のみ）。
- 30秒自動セーブは選択式。Firestoreの読み書き増加を避けるため、前回と同じ状態は再送しない。Realtime Databaseの位置同期は変更時にのみ頻繁に送る。
- 管理者秘密鍵・サービスアカウントJSON・OAuthシークレットは公開サイトやGitHubに置かない。

## 5. 未完了・受入れ検証

- [ ] Firebase Consoleの匿名認証有効化（実環境）
- [ ] Firestore `(default)` の作成とRules公開
- [ ] Realtime Databaseの作成とRules公開
- [x] Realtime Databaseの正確なURL受領と安全な非アクティブ設定への記録
- [ ] 匿名認証と両DBのルール公開を確認し、`databaseURL` を有効化
- [ ] Firestore Rules・Realtime Database Rulesの実エミュレーター認可テスト
- [ ] iPhone Safari/PC間のクラウドセーブと協力・対戦の実機確認

**オンライン戦闘は独立した試験用アリーナ**。既存ベルトライン戦闘そのもののネットワーク同期ではない。BATTLEのクラウド対象も戦闘の初期設定のみ。
