# CCC 2031 Training — PWA

トレイル練習のメニュー確認・完了トラッキング・週次進捗を、UTMB CCC 2031 に向けて。
A trail-training menu / completion tracker / weekly progress PWA on the road to UTMB CCC 2031.

## 機能 / Features
- **今日 (Today)**: その日のメニュー。筋トレは種目チェック、ランは距離入力。完了ボタン。
- **週 (Week)**: 今週の達成リング・距離・直近8週の棒グラフ・次ロングの +10% 目標・CCCまでのカウントダウン。
- **記録 (Log)**: 週ごとに履歴一覧。タップで距離/メモ編集・削除。
- **設定 (Settings)**: レース日、基準ロング距離、週間目標、表示言語(日/英/両方)、Podcastメモ、データ書出/読込。
- 完全オフライン対応 (Service Worker)。ホーム画面アプリとしてインストール可。

## デプロイ / Deploy (GitHub Pages)
1. 同梱の全ファイルをリポジトリ直下（または `/docs`）に置いて push。
2. GitHub → Settings → Pages → Source を該当ブランチ/フォルダに設定。
3. 公開URL（例: `https://<user>.github.io/<repo>/`）を開く。

> 全てルート相対パス (`./…`) なのでサブディレクトリ配信でも動きます。

## iPhone にインストール / Install on iPhone
1. **Safari** で公開URLを開く。
2. 共有ボタン → **「ホーム画面に追加」**。
3. ホームのアイコンから起動 → 全画面・オフラインで動作。

## デイリーブリーフ連携 / Daily-brief integration
「ブリーフ」タブに、[das-daily-brief](https://github.com/TaniMasanori/das-daily-brief) が毎朝生成する
**ニュースレター（リサーチブリーフ + Nature ダイジェスト + 最近の作業サマリー）と
日本語ポッドキャスト**が表示されます。すべてこのアプリ専用（公開RSS配信なし）です。

- ニュースレターも**ポッドキャスト音声も** AES-256-GCM で暗号化されて Pages に置かれ、
  アプリが端末内で復号します。**設定 → 復号キー** に das-daily-brief 側の `BRIEF_ENC_KEY`
  と同じ値を一度だけ貼り付けてください（この1つの鍵で本文も音声も復号します）。
- ポッドキャストは「▶ 音声を再生」をタップすると数MBをDL＋復号して再生します。復号済み音声は
  Cache API に保持されるので、圏外のトレイル上でもオフライン再生できます。
- 朝のプッシュ通知（毎朝 6:30 頃、Web Push）:
  1. アプリをホーム画面に追加（iOS 16.4+ / Android Chrome）。
  2. 設定 → **朝のプッシュ通知を有効化**。
  3. 表示される購読JSONをコピーし、das-daily-brief リポジトリの Secret **`PUSH_SUBSCRIPTIONS`**
     に登録（JSON配列。端末が2台なら `[ {...}, {...} ]`）。
- 最後に取得したブリーフは localStorage にキャッシュされ、圏外のトレイル上でも読めます。

## メモ / Notes
- **ヘルス連携 / 自動距離取得**: SafariのPWAからHealthKitは読めません。距離は手入力、**翌週の +10% は自動計算**します。自動取得したい場合は iPhone「ショートカット」でヘルスの距離→このアプリに渡す運用が可能。
- **ロック画面での音声再生**: iOSのPWAは画面ロックで音声が止まることがあります（Media Session で操作は出ます）。画面を点けたまま／バックグラウンド直後の再生を想定しています。

## データ / Data
記録は端末の localStorage に保存。設定の「書き出し / 読み込み」で JSON バックアップ・移行ができます（2027年の日本移行時のデータ移しにも使えます）。
