# HANDOFF — CC Pocket 実装引き継ぎ

このドキュメントは、新しいClaude Codeセッション or 別の人が CC Pocket の実装を引き継ぐためのコンテキスト集約。Spec（[`specs/`](./specs/)）の前提となる議論・決定事項・実装順序を1箇所に。

最終更新: 2026-05-06

---

## 1. プロジェクトの位置づけ

### なぜこれを作るのか

PCで作業中、Claude Codeが「ツール実行の承認待ち」で頻繁に止まる。PCの前にいないと再開できないため、外出中・ソファ・別作業中の待ち時間が大きい。スマホから即座に承認・指示できれば、待ち時間ゼロでClaude Codeとの体感連続性が大幅に上がる。

### 既存ツールでなぜ足りなかったか

- 公式 Claude Code Web — UIはあるが「PCのセッション」と同じものを操作する設計ではない
- SSH + tmux from mobile — ターミナル直叩きで承認操作のUXが悪い
- Remote Control系 — 接続が安定しない
- [cmux (manaflow-ai)](https://github.com/manaflow-ai/cmux) — デスクトップでは最高、しかしモバイルアクセス機能なし

CC Pocketは「PCのClaude Codeセッションを、スマホネイティブUIで操作する」専用ツール。

### 関連プロジェクト

- [`PokoTech` MEO SaaS](https://...) — 本人の本業
- `Spec Authoring SaaS` — CC PocketのSDDが、このSaaSのドッグフード素材になる
- [`manaflow-ai/cmux`](https://github.com/manaflow-ai/cmux) — 本人がデスクトップで日常使用。v1では独立運用、v2でBridge検討（Q13）

---

## 2. 確定した設計判断（Q1-Q14）

詳細は [`specs/09-open-questions.md`](./specs/09-open-questions.md) 参照。要約:

| # | テーマ | 決定 |
|---|--------|------|
| Q1 | バインドポート | `7700` 固定（旧 `7000` は AirPlay と衝突、2026-05-06 改訂） |
| Q2 | tmuxセッション名 | `config.json`で上書き可、既定 `cc-pocket` |
| Q3 | Claude Code起動 | v1はユーザ手動 (`tmux attach` → `claude`)、v2で自動化 |
| Q4 | ANSIエスケープ | SGRカラー(30-37/90-97)+太字のみ解釈、カーソル制御strip |
| Q5 | 改行コード付与 | クライアント側で付ける |
| Q6 | Push通知本文 | 既定「承認待ち」のみ、設定で出力末尾80文字+マスクに切替可 |
| Q7 | クライアントログ保持 | 永続化しない（サーバが正本） |
| Q8 | 複数同時接続 | 許可、入力は両方反映、出力は全クライアントに配信 |
| Q9 | PWAインストール | 通知のみ必須、それ以外はブラウザでも可 |
| Q10 | サーバ自動起動 | 手動起動のみ（`npm start`） |
| Q11 | ログ検索機能 | v1スコープ外 |
| Q12 | マルチMac対応 | 各Mac独立運用、集約しない（YAGNI） |
| Q13 | cmux統合 | v1は独立、v2でcmux output-subscription待ち |
| Q14 | サーバ停止中の出力 | A+B: tmux.confに永続`pipe-pane` + 起動時`capture-pane`補完 |

---

## 3. アーキテクチャ概要

```
┌──────────────┐                    ┌─────────────────────────────┐
│ スマホ(PWA)  │  HTTPS/Tailscale   │  Mac (Tailnet 100.x.x.x)    │
│              │ ──HTTP POST──→     │  ┌────────────────────────┐ │
│              │ ←─── SSE ──        │  │ Node.jsサーバ          │ │
│              │                    │  │ - 標準モジュールのみ   │ │
└──────────────┘                    │  │ - tmux Driver          │ │
                                    │  │ - Approval Detector    │ │
                                    │  │ - Output Tailer        │ │
                                    │  └─────────┬──────────────┘ │
                                    │            │ child_process  │
                                    │  ┌─────────▼──────────────┐ │
                                    │  │ tmux session "cc-pocket"│ │
                                    │  │  ├─ window 0: claude   │ │
                                    │  │  ├─ window 1: claude   │ │
                                    │  │  └─ window 2: claude   │ │
                                    │  └────────────────────────┘ │
                                    │  ↓ pipe-pane (永続)         │
                                    │  ~/.cc-pocket/pipe/*.log    │
                                    └─────────────────────────────┘
```

詳細は [`specs/02-architecture.md`](./specs/02-architecture.md)。

---

## 4. 実装ロードマップ

### Phase 0: セットアップ (1日)

- [x] このリポジトリをGitHub publicで作成
- [x] Tailscale on Mac + iPhone セットアップ確認
- [x] tmux 3.3+ インストール確認（3.6a, Homebrew）
- [x] `~/.tmux.conf` に永続`pipe-pane` hook追加（[`specs/08-runbook.md`](./specs/08-runbook.md) §8.2.4）
- [x] `~/.cc-pocket/pipe/` ディレクトリ作成

### Phase 1: v0実装 — マニュアル承認モード (1週間)

承認バナーは出さず、Quick Keysで `y/n/1/2/3` を手で送る最小UI。**目的: ツール自体を動かして、Discovery（実出力サンプル）を生活に組み込む**。

- [ ] `server/index.js` — HTTPサーバ + 起動処理
- [ ] `server/tmux.js` — tmux CLI ラッパー (`list-windows`, `send-keys`, `capture-pane`)
- [ ] `server/tailer.js` — `~/.cc-pocket/pipe/*.log` の tail
- [ ] `server/state.js` — in-memory window store（state は `idle`/`streaming` のみ）
- [ ] `server/sse.js` — SSE Broadcaster
- [ ] `server/auth.js` — PIN検証 + token発行
- [ ] `server/routes.js` — `/auth/pin`, `/session`, `/windows/:id/log`, `/windows/:id/input`, `/windows/:id/keys`, `/events`
- [ ] `public/index.html` + `app.js` + `style.css`
  - PIN画面、メイン画面、ドロワー、ログ表示、入力欄、Quick Keys
  - 状態色: 緑(idle)/黄(streaming) のみ
- [ ] `public/manifest.webmanifest` + アイコン
- [ ] `scripts/set-pin.js` — PIN初期設定
- [ ] Tailscale IP に bind して疎通確認
- [ ] スマホから1日試用

**v0完了条件**: 自宅WiFi + Tailnet両方でスマホから接続でき、入力送信と出力受信が正常動作。

### Phase 2: Discovery — 承認パターン収集 (運用しながら2週間)

`~/.cc-pocket/pipe/*.log` に蓄積される実出力から、承認プロンプトのパターンを抽出。**手動コピーではなく、v0使用中に自然に貯まるログを対象**。

- [ ] サンプル分類スプレッドシート作成（10シナリオ × 3サンプル目標）
  - シナリオ: Bash読取系 / Bash破壊系 / Edit / Write / 番号選択 / Subagent / MCP / カスタムコマンド / 複数行貼付 / Always allow後
- [ ] `data/samples/<scenario>/<n>.txt` に分類して保存
- [ ] 観点別抽出: プロンプト末尾シグネチャ / 選択肢の数とラベル / デフォルト選択 / 文脈行数 / ANSI装飾の有無
- [ ] regexドラフト → `data/patterns.json` v1 候補
- [ ] False Positive < 1% / False Negative < 5% の計測テスト
- [ ] 受入合格したらPhase 3へ

詳細は [`specs/05-approval-detection.md`](./specs/05-approval-detection.md) §5.2。

### Phase 3: v1昇格 — 承認バナー + Push通知 (3-5日)

- [ ] `server/detector.js` — `data/patterns.json` ベースのregexスキャン
- [ ] `server/state.js` — `awaiting_approval` 状態追加
- [ ] `server/push.js` — Web Push送信（VAPID）
- [ ] `public/app.js` — 承認バナー UI、状態色 赤(awaiting_approval)、PUSH購読
- [ ] `public/sw.js` — Service Worker でPush受信 + 通知表示
- [ ] `data/patterns.json` v1 確定版コミット

### Phase 4以降

- v0/v1運用しながら不満点を収集
- ネイティブiOSアプリ移行判断（PWA push信頼性とキーボード体験次第）
- cmux Bridge再評価（Q13 v2再評価条件参照）

---

## 5. 実装着手前のチェック

実装するエージェントへ:

1. [`specs/README.md`](./specs/README.md) を読み、9つのSpecファイルを順番に通読
2. このHANDOFFのQ1-Q14決定事項が頭に入っているか確認
3. Phase 1 v0スコープ（承認バナー無し、状態 idle/streaming のみ）であることを念押し
4. **Phase 1 で承認バナー機能を実装してはいけない**。Discovery未完のため、推測でregexを書くと後で破棄になる
5. 1ファイル300行以内 / 外部依存ゼロ / 1クラス1責務 を遵守

---

## 6. 開発ポリシー（CC Pocket 固有）

- **データなし設計はしない** — 実測サンプルが必要な箇所は Discovery TODOで止める
- **コーディングエージェント前提のSpec** — Spec→実装の質問数・推測数・やり直し回数を最小化する
- **ドッグフード意識** — このSpec自体が `Spec Authoring SaaS` の事例になる。曖昧さや抜けを発見したらSpec側を更新する

---

## 7. 既知のリスクと注意点

- **Claude Code出力フォーマット変更**: regex破綻リスク。`patterns.json`に対応バージョンメタデータを持たせ、ミスマッチ時に警告する設計（[`specs/05-approval-detection.md`](./specs/05-approval-detection.md) §5.4）
- **iOS PWA pushの信頼性**: バックグラウンドで殺される可能性。届かない場合はフォールバックUI（メイン画面開いた瞬間にバッジで気づける）必須
- **tmux依存**: cmux移行・自前PTY化は v2以降。v1では tmux 3.3+ 必須
- **Tailscale IP変動**: 起動時に `tailscale ip -4` で都度取得する設計

---

## 8. 連絡・参照

- 設計議論の経緯: このHANDOFFと `specs/09-open-questions.md` で全カバー
- PRD・Spec生成セッション: 2026-05-06、対話ベースで作成（PRD_Perariと同様の体裁）
- 上流参考: [tokium_dev記事](https://zenn.dev/tokium_dev/articles/cc-remote-claude-code-from-smartphone) — 同種ツールの先行実装、Node標準モジュール+SSEで1000行構成
