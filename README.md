# CC Pocket

PCで動いているClaude Codeを、スマホからリアルタイムに見て・入力して・承認操作できるリモートコントローラ。Tailscale経由で外出先からも安全にアクセスできる、自分用のエンジニアリング生産性ツール。

## ステータス

🚧 **Pre-implementation (v0)** — 仕様確定済み、実装着手前。

## 何ができるか（v1完成時）

- スマホ（PWA）からPCのClaude Code出力をリアルタイム表示
- スマホから入力・コマンド送信
- ツール実行承認 (`[y/n]`) をネイティブボタンで操作
- 承認待ち発生時のWeb Push通知
- 複数ワークスペースの状態色分け（Idle / Running / Needs input / Error）
- Tailscale + PIN認証の二段防御で外出先安全

## ドキュメント

| ファイル | 内容 |
|---------|------|
| [`PRD.md`](./PRD.md) | プロダクト要件（なぜ・何を） |
| [`specs/`](./specs/) | SDD実装契約（どう作るか） |
| [`HANDOFF.md`](./HANDOFF.md) | 実装着手のための引き継ぎドキュメント |

## 技術スタック

- バックエンド: Node.js v20+ (標準モジュールのみ、外部依存ゼロ方針)
- フロントエンド: HTML/CSS/JS + Service Worker (PWA)
- 通信: SSE + HTTP POST
- セッション: tmux + `claude` CLI
- 外部アクセス: Tailscale

## 関連

- 参考実装: [tokium_dev — スマホからClaude Codeを操作するツールを作った](https://zenn.dev/tokium_dev/articles/cc-remote-claude-code-from-smartphone)
- 関連プロジェクト: [`manaflow-ai/cmux`](https://github.com/manaflow-ai/cmux) — デスクトップ版で日常使用しているClaude Code GUI（v2でBridge検討）

## ライセンス

未定（公開時に決定）。
