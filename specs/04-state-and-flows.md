# 04. 状態マシン・エラーハンドリング

## 4.1 Window State Machine

```
            ┌────────────────────────┐
            │                        │
            ▼                        │
        ┌──────┐  output      ┌────────────┐
        │ idle │─────────────→│ streaming  │
        └──────┘              └─────┬──────┘
            ▲                       │
            │ idle_threshold        │ pattern matched
            │ (2秒無出力)           ▼
            │                ┌────────────────────┐
            │                │ awaiting_approval  │
            │                └─────┬──────────────┘
            │                      │ approve POST or
            │                      │ stale (>10min)
            └──────────────────────┘

     [error] tmuxプロセス消失等で全状態から遷移可能
```

### 4.1.1 遷移トリガー

| From | To | トリガー |
|------|-----|---------|
| idle | streaming | 出力チャンク受信 |
| streaming | idle | `idle_threshold`（既定2000ms）出力なし |
| streaming | awaiting_approval | `detector` がパターン一致 |
| awaiting_approval | streaming | `/approve` POST成功 → tmuxへキー送信完了 |
| awaiting_approval | idle | `stale_threshold`（既定10分）経過 |
| any | error | `tmux list-windows`でwindow消失検知、または対応するpipeファイルが10秒以上更新されずProc不在 |
| error | idle | window復帰検知時 |

### 4.1.2 不変条件

- `state === 'awaiting_approval'` ⇔ `approval !== null`
- 同一ウィンドウで同時に複数の`awaiting_approval`は持たない（最新で上書き）
- `state === 'error'` のとき入力系API（`/input`, `/approve`, `/keys`）は409を返す

## 4.2 Session Lifecycle

```
[Server起動]
   │
   ▼
[既存tmuxセッション "cc-pocket" 検出]──no──→[新規tmuxセッション作成]
   │ yes                                         │
   └────────────┬────────────────────────────────┘
                ▼
        [全window列挙]
                │
                ▼
   [各windowで capture-pane -S -2000 → ring buffer初期化]  ← Backfill (B)
                │
                ▼
   [pipe-pane再アタッチ確認 / 不在ならhook再発行]            ← 永続記録 (A) は ~/.tmux.conf に焼かれている前提
                │
                ▼
        [HTTP listen + SSE準備]
                │
                ▼
        [running]
                │
                ▼ SIGINT
        [pipe-pane解除 + listenクローズ + tmuxセッションは残す]
                │
                ▼
        [exit 0]
```

**重要**: tmuxセッションはサーバ停止後も残す。再起動でアタッチし直して継続できる。

## 4.3 Output Tailer 仕様

- `~/.cc-pocket/pipe/<window_id>.log` を `fs.watch` または1秒ポーリングで監視
- 末尾追記分のみを読み出してチャンク化
- チャンクサイズ上限: 8KB（超えたら分割）
- in-memory ring bufferに保持（per window: 直近2000チャンク or 2MB、先到達側で切り捨て）

## 4.4 エラーハンドリング

### 4.4.1 tmuxプロセスダウン

- 検知: `tmux list-windows`が10秒以上失敗 or 対象セッション消失
- 動作: 全ウィンドウを`error`遷移、SSEで通知、HTTPは503返却
- 復旧: 30秒間隔で自動再アタッチ試行、成功したら`idle`復帰

### 4.4.2 SSE切断

- クライアント側: `EventSource`の自動再接続に任せる。`Last-Event-ID`で `lastSeq` 渡し
- サーバ側: 切断検知でリスナー削除のみ。データ蓄積はin-memory ring buffer頼り
- 切断中の出力はring bufferに残るので、再接続時に欠落分を配信

### 4.4.3 pipe-paneファイル肥大化

- ローテーション: 各ファイルが10MBを超えたら `mv` してpipe-pane再設定
- 過去ファイルは `~/.cc-pocket/pipe/<window_id>.log.1` 等にN世代保存（既定3世代）

### 4.4.4 入力競合

- 同一ウィンドウへの並行入力: サーバ側でper-window queueを持ち直列化
- 承認待ち中の通常入力: 409を返してUIで誤送信を防ぐ
- 古い承認への応答: `approvalId`不一致で410返却

### 4.4.5 認証エラー

- トークン期限切れ: 401返却、クライアントはPIN入力画面に戻る
- PIN5回失敗: 10分間ロック（IP単位ではなくサーバ単位、自分専用前提）

### 4.4.6 サーバクラッシュ・停止

- 状態は揮発（in-memory）、再起動で全ウィンドウ`idle`からスタート
- **永続記録（A）**: `~/.tmux.conf`に焼いた`pipe-pane`hookが効いており、サーバ停止中もログファイルへの追記が継続している
- **起動時補完（B）**: サーバ起動時に`tmux capture-pane -p -S -2000`で各windowのスクリーンバッファ末尾を取得し、ring bufferに上書き初期化
- 補完優先順位: `~/.cc-pocket/pipe/<window_id>.log` 末尾 と `capture-pane` 結果が乖離した場合、より新しいタイムスタンプ（capture時刻）の方を採用
- クライアントは`snapshot`を再受信してUIリセット

## 4.5 タイムアウト・閾値一覧

| 項目 | 既定値 | 出典 |
|------|-------|------|
| `idle_threshold` | 2000ms | streaming→idle遷移 |
| `stale_threshold` | 600000ms (10分) | 承認待ちの自動破棄 |
| `tmux_health_check_interval` | 10000ms | tmux生存確認 |
| `tmux_reconnect_interval` | 30000ms | エラー復旧試行 |
| `sse_keepalive_interval` | 30000ms | pingイベント |
| `pipe_file_rotate_size` | 10485760 (10MB) | ファイルローテーション |
| `pin_lockout_attempts` | 5 | PINロック発動 |
| `pin_lockout_duration` | 600000ms | ロック時間 |
| `auth_token_ttl` | 86400000ms (24h) | トークン期限 |
| `output_ring_buffer_chunks` | 2000 | per windowログ保持 |
| `output_ring_buffer_bytes` | 2097152 (2MB) | 上記と先着で切り捨て |

すべて環境変数または`config.json`で上書き可能にする（実装時に決める）。
