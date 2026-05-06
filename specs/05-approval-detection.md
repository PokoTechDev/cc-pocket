# 05. 承認検知（Discovery TODO）

## 5.1 ステータス: ⚠️ Discovery未完了

本章は**実装ブロッカー**。`patterns.json` に入る具体的な正規表現は、Claude Codeの実出力サンプルを収集してから策定する。Spec Authoring SaaSの「Failure Case Collection」思想に準拠（実測なき設計をしない）。

仮の正規表現で実装を進めると、Claude Codeのバージョン更新で破綻するパターン依存コードが量産される恐れがある。Discoveryを優先する。

## 5.2 Discovery Plan

### 5.2.1 サンプル収集対象シナリオ

最低限カバーすべき承認シナリオ（実出力をログとして保存する対象）:

| # | シナリオ | 想定出力 |
|---|---------|---------|
| S1 | Bash実行（読み取り系） | `ls`, `cat`等の許可確認 |
| S2 | Bash実行（破壊系） | `rm`, `git push`等の許可確認 |
| S3 | ファイル編集（Edit） | `Edit /path/to/file` 確認 |
| S4 | ファイル新規作成（Write） | `Write /path/to/new` 確認 |
| S5 | 番号選択型プロンプト | `1) Yes 2) No 3) Always` 形式 |
| S6 | サブエージェント起動 | Agent toolの確認 |
| S7 | MCP tool呼び出し | サードパーティ tool確認 |
| S8 | カスタムスラッシュコマンド | プロジェクトコマンドの確認 |
| S9 | 複数行貼り付け確認 | 大量テキスト貼り付け時の確認 |
| S10 | 「Always allow」選択後の挙動 | 2回目以降は確認スキップ確認 |

### 5.2.2 収集手順

1. ローカルで普通にClaude Codeを使い、`script -q tmp/raw.log claude` のように生出力を録画
2. または、CC Pocketのv0プロト（regex無しでpipe-pane出力をそのまま記録）を流して`~/.cc-pocket/pipe/*.log`に貯める
3. 各シナリオごとに最低3サンプル（合計30+サンプル）を集める
4. `data/samples/<scenario_id>/<n>.txt` に保存（v1リポジトリ外、`.gitignore`想定）

### 5.2.3 分類基準

各サンプルから以下を抽出:

| 観点 | 抽出する内容 |
|------|------------|
| プロンプトの末尾シグネチャ | 例: `(y/n)?`, `[1/2/3]:`, `Press Enter to continue` |
| 選択肢の数とラベル | yes/no/always、または番号選択 |
| デフォルト選択 | Enterキー単体で選ばれるもの |
| 直前の文脈行数 | プロンプト確定にどこまで遡る必要があるか |
| ANSI装飾の有無 | カラーコード等が混在するか |

### 5.2.4 受入基準（Discovery完了の定義）

- 30+サンプルが `data/samples/` に蓄積されている
- 各シナリオでregexが命中することを示すユニットテストがある
- **False Positive < 1%**（通常出力を承認待ちと誤検知しない）
  - 計測方法: 承認以外の出力1万行を流して誤検知数を数える
- **False Negative < 5%**（承認待ちを見逃さない）
  - 計測方法: 収集サンプル全件にregexをかけて命中率を測る
- パターン未一致時のフォールバックUI仕様が決まっている（5.3参照）

## 5.3 暫定動作（Discovery完了前のv0実装）

サンプル収集中もツールを使い始められるよう、以下の最小実装でv0を動かす:

### 5.3.1 v0: フォールバックボタン常時表示

- `patterns.json` を空配列で起動
- `Approval Detector` は**常に未検知**状態
- 代わりにUIに「マニュアル操作モード」を用意:
  - 入力欄の横に常時 `y` `n` `1` `2` `3` `Enter` `Esc` `Ctrl+C` の固定ボタン群
  - 出力末尾を見て自分で判断してタップ
- ウィンドウ状態は `idle` / `streaming` のみ（`awaiting_approval`は使わない）

これでv1の体験には届かないが、外出先操作という主目的は満たせる。

### 5.3.2 v1: パターンベース自動検知

Discovery完了後、`patterns.json`を埋めて以下を有効化:
- `awaiting_approval` 状態への自動遷移
- 承認バナー（許可/拒否/常に許可）
- Web Push通知
- 通常入力欄の自動disabled

## 5.4 パターン更新運用

- Claude Codeのバージョンアップで検知失敗が起きた場合の対応:
  - 検知失敗を観測したら該当出力を `data/samples/regression/` に追加
  - regex調整 → ユニットテスト追加 → 再評価
- Patterns.jsonに `targetClaudeCodeVersion` メタフィールドを持たせ、ミスマッチ時はサーバ起動時に警告

## 5.5 Discovery TODO 管理

```markdown
- [ ] S1-S10の最低3サンプルずつ収集（30+サンプル）
- [ ] サンプル分類シート作成（スプレッドシート可）
- [ ] regexドラフト作成
- [ ] False Positive/Negative計測
- [ ] patterns.json v1 確定
- [ ] ユニットテスト整備
- [ ] regression sample収集ワークフロー文書化
```

このTODOが片付かない限り、`awaiting_approval`関連の機能（バナー、Push、状態色 赤）は**実装しない**。
