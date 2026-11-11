# FIELD v0.9.1 — 音が鳴らない問題への修正（iPhone/Safari優先）

日付：2026-11-11（日本時間）  
ユーザー報告：「音鳴らない」

## 現象と原因の区別
- 前版v0.9.0では、すべての楽曲・効果音をWeb Audio APIのリアルタイム合成だけで鳴らしていた。
- Web Audioがブラウザー側で `interrupted` や `suspended` に入る問題、状態が `running` でも無音になる問題がiOS Safari等で報告されている。
- ただし今回の端末で**どの事象が実際の直接原因かは未特定**。本実装は複数の再生経路・試聴・状態確認の追加で問題解消と切り分けを図る。

## v0.9.1で変更した内容
1. `docs/assets/audio/veiled-shrine-loop.wav` — 20.87秒、16 kHz、16-bit PCM、モノラル。オリジナルの魔導遺跡BGM。以前のWeb Audio合成と同じくDマイナー系92 BPM。新しく波形ファイルとして生成。8小節ループ、端部に短いフェード。
2. 効果音の実音声ファイル（同仕様）を7種類追加：`test.wav`、`jump.wav`、`fire.wav`、`slash.wav`、`laser.wav`、`dash.wav`、`land.wav`。
3. `/src/audio/ResilientAudioEngine.ts` を新規追加：既存 `ArcaneAudioEngine` を継承。BGMは通常の `HTMLAudioElement` のループ再生を優先。**ユーザーが音ONを押した同期処理内で `audio.play()` と `AudioContext.resume()` の両方を直ちに呼ぶ**。前版の合成BGMをフォールバックとして保持。iPhoneでは通常の音声ファイルによる効果音を優先、PC/他のブラウザーでは従来のWeb Audioを使える。
4. `/src/audio/ResilientAudioControls.ts` を新規追加：音ON/OFF、実際のブラウザーAPI再生状態の表示、独立した「🔊 テスト音を鳴らす」ボタン、ユーザー操作での音声コンテキスト再開試行を担当する。
5. Xメニューの音声欄に試聴ボタンと再生状態を追加。バージョンはFIELD v0.9.1。

## 画面からのテスト操作
1. `https://kazurgbmaterials.github.io/GedouHukakugo/?v=091` を開く。画面右上の「♫ 音をON」を押す。
2. 音が出ない場合はXでメニューを開き「🔊 テスト音を鳴らす」を押す。テスト音は `test.wav` の約0.55秒の電子音。
3. 「BGM音声ファイル：再生API稼働中 / Web Audio：running」等の再生状態を確認。**APIで再生中と表示しても、端末から実際に音が出るかどうかは保証できない**。
4. BGM/SFXスライダーが0でないこと、iPhone本体のメディア音量、Bluetoothの出力先、Safariでの再生を確認。アプリ内ブラウザーで無音ならSafariのアドレスバーにゲームURLを直接貼り付け、試す。
5. それでも無音ならSafariを完全に終了→新規起動。iOS WebKit側が無音になり、APIが成功を返しても出力されない報告がある。

## 独立性と既存機能保護
- **既存41モジュールのうち変更したのは `/src/main.ts`（DI結線）だけ**。
- 追加2モジュールは前版の既存音声実装を継承し、入力・GameEngine・移動・4スキル・炎弾チャージ・ジャンプ・フィールドエディター・マルチプレイヤー・Firebaseに変更なし。
- 既存のv0.6.2操作性良好ベースライン `baseline/field-v0.6.2-good-controls-20261108` は変更しない。

## 検証と制約
- 43モジュールの構文検査。
- 音ON操作内でHTMLMediaElement.play()とAudioContext.resume()が両方同一イベント中に呼ばれることを模擬テスト。
- iPhone向けの効果音の音声ファイル参照、通常WebAudio経路、WebAudio不在時でもWAVを使う経路、BGM音量、OFF/ON、試聴ボタン、状態表示の操作を模擬テスト。
- **iPhone実機のスピーカーから実際に出たかどうかは未検証**。Playwrightや模擬APIで「音声命令が受け付けられた」ことだけでは人の聴感を保証できない。

## 将来の音響制作方針
今回の音源は「AIドラフト→人が調整/承認」の**仮音源**であり、制作工房GEDO STUDIOの楽曲・SE台帳との完全自動連係はまだ未実装。正式曲ができたらWAV/OGGの差し替えやBGMシーン割当へ進む。
