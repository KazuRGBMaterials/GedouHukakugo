> **旧資料（v0.1）**：現在の保存構成はFirestore＋Realtime Database併用（v0.2）です。オンラインアリーナの4人上限も撤廃されています。最新情報は [ONLINE_HYBRID_v0.2.md](./ONLINE_HYBRID_v0.2.md) を参照してください。

# 外道不覚悟 NEXT — Firebase保存とオンライン協力／対戦 v0.1

状態（2026-11-28）：**Firebase Webアプリ「gedouhukakugo」の公開設定をコードに登録済み。Realtime DatabaseのURL・認証有効化・ルール適用は未確認。** `databaseURL: null` のため実通信は意図的に無効。設定完了まではローカル専用。

## 機能の区分と公開URL

- FIELD NEXT `/GedouHukakugo/next/`：従来の移動・スキル・セーブ・エディタ試遊を維持。クラウドの手動保存/読込/削除と任意30秒自動同期。既存の8文字ルーム機能は参加者の位置同期。
- EDITOR NEXT `/GedouHukakugo/next/editor/`：マップJSONを別スロットにクラウド保存/読込、JSON書出し/取込み。
- BATTLE NEXT `/GedouHukakugo/next/battle/?grid=1`：敵・味方・戦術・マス目・描画など**戦闘の初期設定のみ**クラウドに保存。戦闘途中のHP、予約、タイムラインはまだクラウド保存されない。
- ONLINE NEXT `/GedouHukakugo/next/online/`：**ベルトライン戦闘とは独立した試験用アリーナ**。12文字招待コード。協力＝最大4人で6つの宝石を集める。対戦＝二組のチームで近接攻撃。人数上限4人。スマートフォンの方向キー/攻撃ボタンとPCの矢印キー/WASD/スペース対応。ホストが状態更新の唯一の書き手になる。

**重要：** 「オンライン戦闘」のルールは既存のベルトライン戦闘VER4/NEXTと異なり、現時点ではプロトタイプです。既存戦闘システムでの各参加者のコマンド予約やPvP全体戦術、マップをまたぐ協力イベント、ホスト交代などは未実装です。

## Firebaseセットアップ（管理者が1回のみ実行）

現在のプロジェクト：[Firebase Console / gedouhukakugo](https://console.firebase.google.com/project/gedouhukakugo/overview)

Webアプリは登録済みです。残る作業は匿名認証の有効化、Realtime Databaseの作成、ルールのFirebase側への公開、実際のデータベースURL取得です。

1. [Firebase Console](https://console.firebase.google.com/)でプロジェクトを作成し、Webアプリ登録を実施。**既存のWeb設定があるならその値を使用**する。未確認のIDを推測して埋めない。
2. Authentication > Sign-in method > **Anonymous** を有効にする。ゲストの端末引継ぎをGoogleログインで行う予定なら **Google** も有効にする（本版のUIにはGoogleリンク処理はまだ未接続）。
3. **Realtime Database** を有効化する。テストモードの全公開ルールのまま使わない。
4. `docs/firebase/database.rules.json` のルール全体をRealtime Databaseの「ルール」へ反映して**公開**する。既存`rooms`ルールも含むため部分差し替えではなく現行データベースのルールを確認して統合する。ルールの不一致・拒否は画面上のエラーとなる。
5. Webアプリの公開設定は `docs/assets/firebase-config.js` に登録済み。**残作業は、Firebase Realtime Database >「データ」タブ上部に表示される実際のデータベースURLを確認し、`databaseURL: null` をそのURLに置き換えること。** プロジェクトIDから地域やURLを推測してはいけない。匿名認証の有効化とルール公開を確認するまでは実接続を有効にしない。サービスアカウント、管理者秘密鍵、OAuthシークレット、管理APIトークンは**リポジトリに絶対に置かない**。
6. GitHub Pages上で異なる2ブラウザ/2端末を開き、匿名認証とルールを確認。Firebase側のAuthenticationユーザー一覧、Realtime Databaseの`cloudSaves`、`arenaRooms`を確認する。初回の書込みには通信が必要。
7. Firebaseの利用量・請求アラート、App Checkの導入、悪用対策、不要ルームの期限付き削除を運用前に検討する。**ルームに有効期限はまだない**。

## 保存データの保護

- モード初期値はローカル専用。**利用者が「クラウド利用を有効にする」を押したときだけ**Firebase匿名認証、端末用ランダムID生成とクラウド読書きを開始する。
- クラウドセーブのパス：`cloudSaves/{FirebaseUID}/{slot}`。使用スロット `field-main`, `field-preview`, `editor-map`, `battle-setup`。
- バージョン`schemaVersion=1`とリビジョンに基づき、更新時はRealtime Databaseトランザクションで旧世代を確認する。競合発生時は上書きしない。クラウドに既存保存があれば初回上書きは確認が必要。
- 保存結果がサーバーから正常に返ったときだけ「クラウド保存済み」と表示。オフライン、認証/ルール拒否はエラー表示。
- 端末識別は安全な乱数から作るブラウザ内の32桁hexID。端末機種、IP、OS、ブラウザ指紋は収集しない。端末IDはユーザー認証には使わない。複数端末は通常、別の匿名UIDとなる。
- JSONバックアップ書出し/取込みと確認付きクラウド削除を実装。削除するのはクラウドの対象スロットだけで、元の端末内セーブは削除しない。
- ブラウザデータを消去した匿名ユーザーは以前のUIDに戻れない場合がある。今の版はJSONによる明示引継ぎを用意したが、Googleアカウント連携/安全な一回限りの復旧コードは今後の実装。

## 協力・対戦の動作と限界

- `arenaRooms/{room}/meta`：作成者のFirebase UID、モード、作成日時。
- `arenaRooms/{room}/members/{uid}`：参加者ごとの表示名と入室時刻。断線時はonDisconnectで自分の参加記録を削除。
- `arenaRooms/{room}/inputs/{uid}`：本人だけ書込み可能な移動方向・攻撃・連番。
- `arenaRooms/{room}/state`：ホストのUIDだけが書込み可能な盤面スナップショット。ほかの参加者は購読するだけ。
- 端末ごとの位置を他人が書き換えることはセキュリティルールで拒否する設計。**ホスト自身は状態の書き手なので完全なチート対策にはならない**。本格的な競技PvPではCloud Functions等の権威サーバーが必要。
- 現在のFIELD 8文字ルームとONLINE 12文字アリーナは**別のルーム系統**。互換ではない。
- ルーム参加者は表示名が相互に見える。ランダム端末ID、個人のセーブ、メールアドレスはルーム参加者へ公開しない。
- 匿名認証だけでは別端末で同じ本人の個人セーブを自動共有しない。JSON引継ぎか将来のアカウント連携が必要。

## モジュールの変更許可境界

```text
docs/next/cloud/
  identity.js             ランダムID・招待コード
  firebase-service.js     明示的認証 / SDKロード
  save-store.js           UID所有・世代チェック
  save-panel.js           保存UIと任意自動保存
  init-{field,editor,battle}.js   旧コアの外側のDI
docs/next/online/
  arena-engine.js         純粋な協力/PvPアリーナロジック
  room-adapter.js         ホスト・参加者・操作同期
  online.js, index.html   表示と操作
docs/firebase/database.rules.json  RTDB認可と入力検証
```

旧版`docs/index.html`, `docs/battle/**`, `docs/editor/**`および保存キーは不変更。`docs/next/index.html`の埋め込みmainモジュールだけ、状態復元用ポートを追加。Firebase依存はGameCoreには導入しない。

## 検証と運用上の注意

- Node.jsの純粋関数テスト（端末ID、保存競合、協力・対戦ロジック、保存ルールファイル）をGitHub Actionsで実行。
- **未実施**：Firebaseの実プロジェクトでの接続試験、Realtime Database Emulatorでのルール拒否試験、2台のiPhoneを使った同時対戦、負荷・料金・遅延測定。
- 実プロジェクトでルールを適用するまでは、オンライン保存・ルーム参加は機能しません。GitHub Pagesへコードを公開しただけでFirebaseバックエンドが完成したことにはなりません。
