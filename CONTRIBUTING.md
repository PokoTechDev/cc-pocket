# Contributing to CC Pocket

CC Pocket は単一ユーザ向けの自宅運用ツールです。マルチユーザ・クラウドホスティング・他OS対応は **Out of Scope**（[`CLAUDE.md`](./CLAUDE.md) §Out of Scope 参照）。

このリポジトリは **Spec-Driven Development (SDD)** で運用しています。実装の前提となる Spec が [`specs/`](./specs/) にあり、AI agent も人間 contributor も同じ Spec に従います。

## Prerequisites

- macOS 14+
- Node.js 20+
- tmux 3.3+
- Tailscale（Mac + 動作確認用スマホ）

## Setup

```bash
git clone git@github.com:PokoTechDev/cc-pocket.git
cd cc-pocket

# Phase 1 v0 実装後に有効になるコマンド:
# node scripts/set-pin.js   # PIN 初期設定
# npm start                 # サーバ起動
```

セットアップ詳細は [`specs/08-runbook.md`](./specs/08-runbook.md)。

## Development Workflow

実装作業の流れは [`HANDOFF.md`](./HANDOFF.md) §4 で定義。Phase 0 → 1 → 2 → 3 の順に進みます。

各 Phase 内では:

1. 該当 Spec を読む（[`specs/README.md`](./specs/README.md) 経由で順番に通読）
2. 1 ファイル単位でブランチを切って実装
3. ローカルで動作確認 → PR

### Implementation Constraints

実装前に [`CLAUDE.md`](./CLAUDE.md) §Strict Implementation Constraints を必ず確認:

- **外部依存ゼロ** — Node 標準モジュールのみ
- **1 ファイル 300 行以内**
- **承認検知 regex の推測実装禁止**（Phase 3 の Discovery 完了まで）
- **listen は Tailscale IP に**（`0.0.0.0` / `127.0.0.1` 禁止）

## Commit Conventions

[Conventional Commits](https://www.conventionalcommits.org/) に従います。

### Format

```
<type>: <description>

[optional body]
```

### Types

| Type | Use |
|------|-----|
| `feat` | 新機能追加 |
| `fix` | バグ修正 |
| `refactor` | 振る舞い変更なし、構造のみ変更 |
| `docs` | ドキュメント更新（**Spec 変更も含む**） |
| `test` | テスト追加・修正 |
| `chore` | ビルド設定、依存、CI、リネーム等 |
| `perf` | パフォーマンス改善 |
| `ci` | CI/CD のみ |

### Granularity Rules

**1 コミット = 1 論理変更**。AI agent でも人間でも同じ。

| ルール | 理由 |
|--------|------|
| 各コミットは単独でビルド・動作する状態に保つ | `git bisect` での回帰特定が容易 |
| 関連しない変更を 1 コミットに混ぜない | revert/cherry-pick の柔軟性 |
| AI 生成コードは「機能単位 = コミット単位」に分割 | 巨大な一括コミットはレビュー困難 |
| Spec 変更と実装変更は別コミット | Spec → 実装の追跡可能性（SDD 必須要件） |
| 自動生成ファイル（lockfile 等）は対応する変更と同じコミットに含める | 「lockfile だけ変わった」コミットの無意味さ |

### Anti-patterns

避けること:

- ❌ `chore: WIP` のような意味のないメッセージ
- ❌ `feat: implement everything for Phase 1` のような巨大コミット
- ❌ `docs: typo` を 5 個に分けた連続コミット（squash すべき）
- ❌ Spec 変更と実装変更を同一コミットに混ぜる
- ❌ AI agent が一括生成したコードを無分割でコミット

## Pull Requests

### Branch Naming

- `feature/<short-desc>` — 新機能
- `fix/<short-desc>` — バグ修正
- `refactor/<short-desc>` — リファクタ
- `docs/<short-desc>` — ドキュメント
- `spec/<short-desc>` — Spec のみ更新

### PR Body Template

```markdown
## Summary

[1-3 行で変更内容]

## Spec Reference

- [`specs/XX-<file>.md`](...) §X.Y

## Phase

Phase 1 (v0) — マニュアル承認モード

## Test Plan

- [ ] ローカルで `npm start` 起動確認
- [ ] スマホから疎通
- [ ] 既存機能の回帰なし

## Notes

[補足、設計判断、既知の制限]
```

### Review Process

CC Pocket は単一メンテナ運用です。マージは [@NaokiOouchi](https://github.com/NaokiOouchi) が行います。AI 主導の PR でも人間が必ずレビューします。

## Spec Changes

[`specs/`](./specs/) を更新するときの順序:

1. **既存 Spec との一貫性を確認** — 特に [`specs/09-open-questions.md`](./specs/09-open-questions.md) Q1-Q14 の決定事項と矛盾しないか
2. **Phase 整合性を確認** — v0 で v1 機能を Spec に書き込まない、等
3. PR タイトル: `docs: update specs/XX — <reason>`
4. 実装変更とは **別 PR** にする（追跡可能性のため）

## AI Agent Operation

AI agent（Claude Code、Cursor、Cline、Aider、Codex 等）は [`AGENTS.md`](./AGENTS.md) を最初に読むこと。Claude Code は [`CLAUDE.md`](./CLAUDE.md) を自動読込します。

### Mirroring AGENTS.md / CLAUDE.md

[`AGENTS.md`](./AGENTS.md) と [`CLAUDE.md`](./CLAUDE.md) は **完全に同一内容**で運用します（cmux 流）。理由:

- Claude Code は `CLAUDE.md` を自動読込
- 他の AI agent は `AGENTS.md` を読む（[OpenAI/Cursor 共通標準](https://agents.md)）
- Symlink ではなくファイル複製にすることで Windows 等のクロスプラットフォーム互換性を確保（CC Pocket 自体は macOS-only だが、コードレビュー時にブラウザで読まれる前提）

**一方を編集したら必ずもう一方も同期更新**してください。同期忘れを防ぐため、編集時はコミット内に両ファイルを含めることを推奨。

## Reporting Issues

[GitHub Issues](https://github.com/PokoTechDev/cc-pocket/issues) で受付。再現手順、`tmux ls` の出力、`~/.cc-pocket/pipe/` の状態を含めてください。

## License

MIT — [`LICENSE`](./LICENSE) を参照。
