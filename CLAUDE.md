# CLAUDE.md — CC Pocket Project Instructions

---

## 🚀 BOOTSTRAP — 初回セッションで最優先で実行

**このセクションは未完了。完了したら本セクション全体を削除すること。**

このプロジェクトはまだGitHubリポジトリ化されていない。新規セッション起動時、最初のユーザ発話を待たずに以下を順に質問・実行する。

### Step 1: 質問

ユーザに以下を一問ずつ確認する（一括ではなく順に）:

1. **GitHub repo owner** — 推奨: `pokotech-dev`（`pokotech.dev@gmail.com`紐付けアカウント）。別Orgの場合はそちらを聞く
2. **リポジトリ名** — 推奨: `cc-pocket`（既定）
3. **ライセンス** — 推奨: `MIT`。他に `Apache-2.0`/`UNLICENSED`等の選択肢あり

### Step 2: 実行（全質問に回答が揃ったら）

```bash
# 1. ライセンスファイル作成（選択に応じて）
#    MITの場合は標準テンプレートを LICENSE に書き出し、
#    package.json の "license" を "UNLICENSED" → 選択値に更新

# 2. git init + 初回コミット
git init
git add .
git commit -m "chore: initial commit — PRD, SDD spec, project skeleton

Spec/PRDはモバイルからClaude Codeを操作するためのSDD実装契約。
v0実装着手前のpre-implementation状態。詳細は HANDOFF.md 参照。"

# 3. GitHub publicリポジトリ作成 + push
gh repo create <owner>/<name> --public --source=. --remote=origin --push
```

実行前に**ユーザに最終確認**を取ること（外部副作用あり）。

### Step 3: 完了処理

- このBOOTSTRAPセクション（区切り線含む）をCLAUDE.mdから削除
- HANDOFF.md §4 Phase 0 のチェックリスト1項目目「GitHub publicで作成」にチェック
- ユーザに「ブートストラップ完了。Phase 1 v0実装に進めます」と案内

---

## Project Summary

CC Pocket is a remote controller that lets you operate a Mac-side Claude Code session from your phone (PWA). Real-time output streaming, input from mobile, native UI buttons for approval prompts, multi-window state indicators. Tailscale-only access for security.

## Required Reading Before Implementation

**読む順を絶対に守る**:

1. [`HANDOFF.md`](./HANDOFF.md) — 全体コンテキストとPhase別ロードマップ
2. [`PRD.md`](./PRD.md) — プロダクト意図
3. [`specs/`](./specs/) 全章を順番に — SDD実装契約

`specs/09-open-questions.md`のQ1-Q14決定事項は実装の前提条件。逸脱しないこと。

## Strict Implementation Constraints

- **外部依存ゼロ** — Node.js標準モジュールのみ (`http`, `https`, `fs`, `child_process`, `crypto`, `path`, `url`)。`npm install <pkg>` するときは必ず確認をとる
- **1ファイル300行以内** — 超えそうになったら分割
- **承認検知regexの推測実装禁止** — `data/patterns.json` は Discovery完了まで空配列。Phase 1（v0）では承認バナー機能自体を実装しない
- **状態の永続化禁止** — クライアントログはメモリのみ、サーバ状態は揮発でOK（pipe-paneファイルが正本）
- **listen は必ず Tailscale IP に** — `tailscale ip -4` で取得、`0.0.0.0`や`127.0.0.1`は使わない

## Phase 1 (v0) Scope — 厳守

実装してよいもの:
- HTTPサーバ + SSE / 入力POST / Quick Keys
- PIN認証 + Token発行
- tmux Driver（`list-windows`, `send-keys`, `capture-pane`）
- Output Tailer（`~/.cc-pocket/pipe/*.log` を監視）
- ドロワー型UI、ログ表示、入力欄、Quick Keys (`y`/`n`/`1`/`2`/`3`/`Esc`/`^C`)
- 状態は `idle` / `streaming` のみ

実装してはいけないもの（Phase 3まで保留）:
- 承認バナーUI
- `awaiting_approval` 状態
- Web Push通知
- `data/patterns.json` のregex内容

## Architecture Decisions

詳細は `specs/02-architecture.md`。要点:
- tmux pipe-pane を `~/.tmux.conf` に永続フックとして焼き、サーバ停止中も `~/.cc-pocket/pipe/<window_id>.log` に記録継続
- サーバ起動時に各 window で `tmux capture-pane -p -S -2000` で末尾補完
- SSE は単方向push、入力は HTTP POST
- 認証は PIN → Token (24h)

## Coding Style (Project-specific)

ユーザのグローバル `~/.claude/rules/` に従いつつ、CC Pocket固有として:

- ES Modules (`type: "module"` in package.json)
- Async/await ベース、コールバック地獄禁止
- ANSIコード解釈はSGRカラー(30-37/90-97)+太字のみ、それ以外strip
- 改行コードはクライアントが付与、サーバは透過
- JSON-line形式（NDJSON）はSSEのdata部にそのまま流す
- ログ出力は `[CC Pocket] <level>: <message>` 形式

## Testing Strategy

- ユニットテスト: tmuxラッパー、Tailerの差分検出、PIN検証、token管理
- 統合テスト: SSE接続→出力受信→入力送信ラウンドトリップ
- E2E: 実機（iPhone）でPWAインストール→PIN→操作のシナリオ
- Phase 3で追加: regex False Positive/Negative テスト（`data/samples/` ベース）

## Useful Commands (実装時)

```bash
# 開発起動
npm start

# tmux session確認
tmux ls
tmux attach -t cc-pocket

# pipe-pane確認
ls -la ~/.cc-pocket/pipe/
tail -f ~/.cc-pocket/pipe/@0.log

# Tailscale確認
tailscale ip -4
tailscale status

# 完全リセット
tmux kill-session -t cc-pocket
rm -rf ~/.cc-pocket/pipe/*
```

## Out of Scope (絶対実装しない)

- マルチユーザ・チーム機能
- クラウドホスティング（自宅Mac固定）
- Linux/Windows対応
- 音声入力
- ログ検索機能（v1）
- 自動起動 (launchd)（v1）
