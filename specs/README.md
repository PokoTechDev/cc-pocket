# CC Pocket — Spec Index

製品意図は [`../PRD.md`](../PRD.md) を参照。本ディレクトリは実装契約（SDD）。実装着手の流れは [`../HANDOFF.md`](../HANDOFF.md) を先に読むこと。

## ステータス

- バージョン: 0.1（Pre-implementation）
- 更新日: 2026-05-06
- 想定読者: 実装するコーディングエージェント / 本人レビュー時の自分

## 読む順序

| # | ファイル | 内容 | 読む順 |
|---|---------|-----|------|
| - | `README.md` | この索引 | 1 |
| 01 | `01-scope.md` | スコープ・用語集・ユーザストーリー（AC付き） | 2 |
| 02 | `02-architecture.md` | コンポーネント・責務・ファイル配置・シーケンス | 3 |
| 03 | `03-contracts.md` | データモデル・HTTP/SSE API契約 | 4 |
| 04 | `04-state-and-flows.md` | 状態マシン・エラーハンドリング | 5 |
| 05 | `05-approval-detection.md` | 承認検知（Discovery TODO） | 6 |
| 06 | `06-ui.md` | 画面・コンポーネント・インタラクション | 7 |
| 07 | `07-nfr-security.md` | 非機能要件・脅威モデル | 8 |
| 08 | `08-runbook.md` | セットアップ・運用手順 | 9 |
| 09 | `09-open-questions.md` | 未解決の判断事項 | 10 |

## 設計ポリシー

1. **データなし設計はしない** — 実出力サンプルが必要な部分（承認検知パターン等）は推測で書かず、Discovery TODOとしてスタブ化する。Spec Authoring SaaSのFailure Case Collection思想に準拠。
2. **コーディングエージェント前提** — 質問数 / 推測数 / 受入失敗 / やり直し回数を最小化することを目標に書く。
3. **ドッグフード** — 本Spec自体がSpec Authoring SaaSの参考事例になる。曖昧さ・抜け漏れを発見したら回収する。

## 改訂ログ

- 0.1 (2026-05-06) — 初版（Pre-implementation）
