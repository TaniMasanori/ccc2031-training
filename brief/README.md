# Daily Research Brief 🎧📑

毎朝、GmailとGoogleカレンダーから情報を自動収集し、**LLM(Claude)が編集者として整理**して、
**ポッドキャスト音声**と**7枚のスライドPDF**にまとめて自分に届ける個人エージェントです。

```
GitHub Actions (毎朝cron)
      │
      ├─ collect   : Gmail(論文アラート) + Calendar(当日予定) を取得
      ├─ curate    : Claude が関連論文を絞り込み・要約・スライド構成を生成 (構造化JSON)
      ├─ dedup     : 既読論文を除外 (state/seen.json)
      ├─ slides    : 7枚のスライドをPDF化 (fpdf2)
      ├─ generate  : AutoContent API でポッドキャスト音声を生成 (Phase 2)
      ├─ distribute: 音声を GitHub Pages に公開しRSS更新 / ブリーフ+スライドをメール
      └─ commit    : state と docs/ をリポジトリに書き戻し
```

- **Phase 1**: 収集 → キュレーション → スライド → メール送信(ブリーフ + スライドPDF)
- **Phase 2**: 上記 + ポッドキャスト生成 + プライベートRSS配信

`PHASE` を `1` → `2` に切り替えるだけで段階移行できます。

---

## 必要なもの

- GitHub リポジトリ(無料)
- 個人の Google アカウント(Gmail / Calendar)
- Anthropic API キー(LLMキュレーション用)
- AutoContent API キー(Phase 2 のポッドキャスト用 / 有料)

> INPEXの業務メールは使いません。すべて個人アカウント前提です。

---

## セットアップ手順

### 1. リポジトリを用意
このフォルダをそのまま GitHub リポジトリにします。

```bash
git init && git add . && git commit -m "init daily brief"
# GitHubで空のリポジトリを作り、push
git remote add origin https://github.com/<your-username>/das-daily-brief.git
git push -u origin main
```

### 2. Google Cloud で OAuth を設定
1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成。
2. **Gmail API** と **Google Calendar API** を有効化。
3. 「OAuth 同意画面」を構成し、公開ステータスを **「本番(In production)」** にする。
   - これでリフレッシュトークンが**約7日で失効しなくなります**(テストのままだと毎週切れる)。
   - 自分専用なので、認証時の「確認されていないアプリ」警告は「詳細 → 移動」で通過してOK。
4. 「認証情報」→ OAuth クライアント ID を **「デスクトップアプリ」** で作成。
   - `client_id` と `client_secret` を控える。

### 3. リフレッシュトークンを取得(ローカルで一度だけ)
```bash
pip install -r requirements.txt
export GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
export GOOGLE_CLIENT_SECRET=xxxx
python scripts/get_refresh_token.py
# ブラウザで承認 → 表示される GOOGLE_REFRESH_TOKEN を控える
```

### 4. AutoContent API キー(Phase 2)
[autocontentapi.com](https://autocontentapi.com) でプランに登録するとメールでAPIキーが届きます。
日次運用なら Amateur プラン(€29/月・1,000クレジット・ポッド1本=10クレジット)で足ります。
余裕を持たせるなら Professional(€69/月・5,000クレジット)。

### 5. GitHub に Secrets / Variables を登録
リポジトリの **Settings → Secrets and variables → Actions**。

**Secrets(秘匿値):**
| 名前 | 値 |
|---|---|
| `GOOGLE_CLIENT_ID` | 手順2の client_id |
| `GOOGLE_CLIENT_SECRET` | 手順2の client_secret |
| `GOOGLE_REFRESH_TOKEN` | 手順3のトークン |
| `ANTHROPIC_API_KEY` | Anthropic のキー |
| `AUTOCONTENT_API_KEY` | AutoContent のキー(Phase 2) |

**Variables(非秘匿の設定):**
| 名前 | 例 |
|---|---|
| `PHASE` | `1`(最初) → 後で `2` |
| `GMAIL_QUERY` | `newer_than:2d (label:paper-alerts OR from:scholar.google.com)` |
| `TIMEZONE` | `America/Denver` |
| `MAIL_TO` | 空欄でOK(自分宛) |
| `PODCAST_BASE_URL` | `https://<your-username>.github.io/das-daily-brief` |
| `PODCAST_TITLE` | `Daily Research Brief` |
| `PODCAST_AUTHOR` | `Masanori Tani` |
| `PODCAST_LANGUAGE` | `ja` |

### 6. GitHub Pages を有効化(Phase 2 のRSS配信用)
**Settings → Pages** で、ソースを **Deploy from a branch**、ブランチ `main` の **`/docs`** フォルダに設定。
公開URLが `https://<your-username>.github.io/das-daily-brief` になり、これが `PODCAST_BASE_URL`。

### 7. Gmail 側の準備(論文アラートの仕分け)
Google Scholar / ジャーナルTOC / Elicit のアラートメールに、Gmailのフィルタで
`paper-alerts` ラベルを自動付与しておくと、`GMAIL_QUERY` がきれいに効きます。

### 8. ローカルで試運転
```bash
cp config.example.env .env   # 値を埋める
export $(grep -v '^#' .env | xargs)
python -m src.main           # まず PHASE=1 推奨
python test_offline.py       # 認証不要の自己テスト(任意)
```

### 9. 自動運用
`.github/workflows/daily-brief.yml` が毎朝 13:00 UTC(≒山岳部 朝6〜7時)に実行します。
Actions タブの **Run workflow** で手動実行もできます。
まず `PHASE=1` で数日まわして収集・キュレーションを安定させ、問題なければ `PHASE=2` に変更。

### 10. ポッドキャストを購読
ポッドキャストアプリ(Overcast / Pocket Casts / Apple Podcasts の「URLから追加」)に
`https://<your-username>.github.io/das-daily-brief/podcast.xml` を貼って購読。

---

## トレーニングアプリ連携（ブリーフ配信 + 朝のプッシュ通知）

[ccc2031-training](https://github.com/TaniMasanori/ccc2031-training) の「ブリーフ」タブに
ニュースレターとポッドキャストを配信します。**公開RSS（Apple Podcast等）は廃止**し、
音声もアプリ専用の暗号化配信にしています。ポイント:

- 毎朝の実行時に、リサーチブリーフ + **Nature Daily Brief**（別のクラウドルーチンが
  Gmail下書きとして作成 → `gmail.readonly` でここが取得）+ **最近の作業サマリー**
  （下記 Obsidian）+ 最新エピソード情報を1つのJSONにまとめ、**AES-256-GCM で暗号化して
  `docs/brief.enc`** に公開します。読めるのは鍵を持つ端末だけです。
- **ポッドキャスト音声も暗号化**（`docs/audio/brief-<date>.mp3.enc`）。アプリが取得して
  端末内で復号し再生します（オフライン用にCache API保持）。研究内容が公開URLに載りません。
- 音声は **`PODCAST_LANGUAGE=ja` で日本語ナレーション**。冒頭で「最近の作業の振り返り」を話します。
- コミット後のステップで **Web Push** を送信し、スマホのPWAに「今朝のブリーフ」通知を出します。

**Obsidian 作業サマリー:** CIで非公開の Obsidian vault リポジトリ（`10_Daily/` のみ・
読み取り専用デプロイキー）を sparse checkout し、直近数日の日次ノートを Claude が
プロジェクト別に日本語要約します（`src/obsidian.py`）。

**追加の Secrets:** `BRIEF_ENC_KEY`（32バイトbase64url・PWA側の設定に同じ値を入力／音声もこの鍵で暗号化）、
`VAPID_PRIVATE_KEY`（公開鍵はPWAの `data.js` に埋め込み）、
`PUSH_SUBSCRIPTIONS`（PWAの設定画面からコピーした購読JSONの配列）、
`OBSIDIAN_DEPLOY_KEY`（vaultリポジトリの読み取り専用SSHデプロイキー）。
**任意の Variables:** `NATURE_DIGEST_QUERY` / `TRAINING_APP_URL` / `PUSH_CLAIMS_EMAIL` /
`OBSIDIAN_DAILY_SUBDIR` / `OBSIDIAN_LOOKBACK_DAYS`。
`BRIEF_ENC_KEY` が空ならブリーフ配信＋音声暗号化は無効、`OBSIDIAN_DIR`（CIでは自動設定）が
空なら作業サマリーだけ無効になります。

cron は 12:30 UTC（≒朝6:30 MDT）。Nature ルーチン（12:00 UTC）の**後**に走らせる時刻です。

---

## カスタマイズ

- **関連性の精度** … `profile.md` を編集。研究の重点・HIGH/MEDIUM/LOWの基準を具体化するほど精度が上がります。
- **LLMの質とコスト** … `ANTHROPIC_MODEL`。日次なら Haiku で十分、質を上げたいなら Sonnet。
- **スライド枚数** … `src/curate.py` の `slide_outline` の `minItems/maxItems`(既定6 + 表紙 = 7枚)。
- **配信頻度/コスト抑制** … cron を週次にする、または「新着論文がある日だけ起動」する分岐を `main.py` に追加。
- **エピソード保持数** … `EPISODE_RETENTION`(古い音声を自動削除しリポジトリ肥大を防止)。

---

## 注意点・トラブルシュート

- **cron は UTC**。夏時間で1時間ずれます。スケジュール実行は混雑時に数分遅延し、リポジトリが
  60日間無活動だと自動で停止します(手動実行で復活)。
- **OAuthトークンが切れる** → 同意画面が「テスト」のまま。手順2-3で「本番」にして取り直す。
- **ポッドが生成されない** → AutoContent のレスポンス項目名が変わった可能性。`src/generate.py` の
  `_extract_id` / `_extract_audio_url` が拾うキー名を [docs.autocontentapi.com](https://docs.autocontentapi.com)
  で確認して調整。音声生成に失敗してもブリーフのメールは届く設計です。
- **スライドの日本語が `?` になる** → CIでは `fonts-ipafont-gothic` を入れて `FONT_PATH` を渡しています。
  ローカルで日本語にしたい場合は任意の日本語TTFのパスを `FONT_PATH` に設定。
- **モデルIDや料金** は変わり得ます。最新は [docs.claude.com](https://docs.claude.com) で確認してください。

---

## ファイル構成

```
.
├── profile.md                     ← 研究プロフィール(LLMに毎回注入。要編集)
├── config.example.env             ← 環境変数テンプレート
├── requirements.txt
├── scripts/get_refresh_token.py   ← OAuthトークン取得(ローカル一度きり)
├── src/
│   ├── config.py                  ← 設定の読込・検証
│   ├── collect.py                 ← Gmail + Calendar 収集
│   ├── curate.py                  ← Claude キュレーション(構造化出力)
│   ├── state.py                   ← 既読論文の重複排除
│   ├── slides.py                  ← 7枚スライドPDF生成
│   ├── generate.py                ← AutoContent 音声生成(Phase 2)
│   ├── distribute.py              ← RSS生成 + メール送信
│   └── main.py                    ← オーケストレーター
├── docs/                          ← GitHub Pages(podcast.xml / audio / index.html)
├── state/seen.json                ← 重複排除state(Actionが書き戻す)
└── .github/workflows/daily-brief.yml
```
