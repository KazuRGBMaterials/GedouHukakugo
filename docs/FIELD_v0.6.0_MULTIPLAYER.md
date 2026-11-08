# FIELD v0.6.0 — 複数端末で同一フィールドを共有する

**状態：フロントエンド実装済み／Firebaseプロジェクトへの接続待ち。**
GitHub Pagesだけでは他端末とプレイヤー状態を同期できません。以下の手順を完了すると、
iPhone、Windows PC1/PC2、タブレットを同時接続できます。

## 利用者の操作

1. 全端末で同じ `https://kazurgbmaterials.github.io/GedouHukakugo/` を開く。
2. 1台目で「🌐 ルーム」→表示名と色を設定→「新しい部屋を作る」。
3. 生成された8文字コードを共有。招待リンクをコピーして別端末へ送ってもよい。
4. 2〜4台目で「🌐 ルーム」→同じコードを入力→「コードで参加」。
5. **各端末は自分だけ操作し、ほかの端末のMAGEキャラが同じフィールドに表示される。**
   ほかのキャラには個別の名前と色付きの目印が付く。
6. 「退出」で自分のプレイヤーのみ削除。通信切断時もFirebase `onDisconnect` が削除を予約する。

## Firebaseを最初の1回だけ設定する（開発者用）

1. https://console.firebase.google.com/ でFirebaseプロジェクトを作成する。
2. 「プロジェクトの概要」→ウェブアプリ追加から**Webアプリ**を登録する。
3. 「Authentication」→ログイン方法→**匿名**を有効化。
4. 「Realtime Database」を作成する。**テストモードのまま公開しない。**
5. Realtime Databaseの「ルール」欄にこのリポジトリの
   [database.rules.json](./firebase/database.rules.json) 内のルールJSONを貼り付け、**Firebase側で公開**する。
6. FirebaseのWeb SDK設定（apiKey, authDomain, databaseURL, projectId, appId等）を
   `docs/assets/firebase-config.js` の `firebaseConfig = null` と置き換える。
   例（**架空値・実際には動きません**）:
   ```js
   export const firebaseConfig = {
     apiKey: "FROM_FIREBASE_CONSOLE",
     authDomain: "PROJECT.firebaseapp.com",
     databaseURL: "https://PROJECT-default-rtdb.REGION.firebasedatabase.app",
     projectId: "PROJECT",
     appId: "FROM_FIREBASE_CONSOLE"
   };
   ```
7. GitHubへコミットするとPagesが自動更新される。新しいページを4端末で開き直す。
8. 必要に応じてFirebaseの認証済みドメインにGitHub Pagesのホスト名を登録。

Web SDKの `apiKey` はブラウザ用の設定値であり、Firebaseのサービスアカウント秘密鍵とは異なります。
**秘密鍵・サービスアカウントJSON・管理者トークンはGitHubに置かないでください。**
認証・アクセス制御の実効性はFirebaseのRealtime Databaseルールに依存します。

## 仕組みと保護範囲

| 変更範囲 | 内容 |
|---|---|
| `docs/assets/multiplayer-room.js` | Firebase Authentication匿名ログイン、部屋ID、接続ID、8Hz送信、購読、接続切断処理 |
| `docs/assets/firebase-config.js` | Web SDK設定（未設定時はSOLO表示） |
| `docs/assets/multiplayer.css` | スマホ対応ルームUI |
| `/src/multiplayer/RemotePlayerStore.ts` | 通信に依存しない遠隔プレイヤーの座標管理、描画補間 |
| `/src/multiplayer/MultiplayerFieldRenderer.ts` | 既存MAGEのスプライトを使った遠隔プレイヤー表示 |
| `/src/main.ts` | DI結線とローカルプレイヤー状態を読み出すポート |
| `docs/index.html` | ルームUI表示および2つの新コンポーネント登録 |

既存の移動・衝突・ジャンプ・スキル・操作入力モジュールは変更していません。
スマホとPCで同じIPアドレスでも、Firebase匿名認証ユーザーと各ページの接続IDを使うためプレイヤーは共有されません。
同じブラウザプロファイルの複数タブでも、接続IDが別なので別キャラにできます。

## 現段階で同期する／しないもの

**同期する**: プレイヤー位置、向き、移動中フラグ、表示名、目印の色、オンライン参加人数。

**まだ同期しない**: スキル弾・斬撃・レーザーなどのエフェクト、他プレイヤーへの命中やダメージ、
HP/MP、敵、アイテム、セーブデータ、ワールド状態、衝突判定のサーバー権限。
今回は**同じ場に別キャラが存在して独立操作できる最小版**です。

## セキュリティ・費用・制限

- 部屋コードを知る匿名認証済みユーザーは、その部屋の座標を閲覧でき、**自分の接続IDの位置だけ**を書き込めます。
- これは家族での開発テスト用であり、秘密のプライベートルームやチート防止、人数上限、強い招待認可を保証しません。
- レートは約8回/秒/移動端末＋必要時のハートビート。使用量・帯域・請求額はFirebaseで確認。
- Firebase切断反映には遅延がありえます。通信が切れた端末は一定時間残る場合があります。
- ブラウザ単位で匿名ユーザーを管理し、ルーム参加時はページ接続単位でプレイヤーIDを発行します。
- Firebaseの設定・ルール登録完了前は、SOLOのフィールド操作のみ利用可能です。
- 外部SDKが読み込めない場合も既存の1人用ゲームは停止しません。
- 構成はプロトタイプ。実運用前にはFirebase Emulator Suiteでルールを検証し、
  App Check・認証方式・レート制限・同時接続人数・サーバー側判定を追加検討してください。

## 実機確認チェック

- [ ] iPhone/PC1/PC2/タブレットから同じコードで接続して4人表示される
- [ ] 各端末の自キャラ操作がほかのキャラへ伝播しない
- [ ] 同一ネットワーク／別ネットワークの両方で同期する
- [ ] PCキーボード・iPhone仮想スティック・4スキル・ダッシュ・ジャンプが従来通り
- [ ] ページを閉じると他端末からそのプレイヤーが消える
- [ ] 屋外回線から再接続しても整合する
- [ ] ゲームのフルスクリーン中でもルームUIが使用可能
