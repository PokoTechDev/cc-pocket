# 02. アーキテクチャ

## 2.1 コンポーネント

```
┌──────────────────────┐                    ┌─────────────────────────────┐
│  PWAクライアント     │                    │  Mac (Tailnet 100.x.x.x)    │
│  (スマホブラウザ)    │                    │                             │
│                      │                    │  ┌────────────────────────┐ │
│  ┌────────────────┐  │  HTTPS/Tailscale   │  │ Node.jsサーバ          │ │
│  │ App Shell      │  │ ──────────────────→│  │ - HTTP API             │ │
│  │ (HTML+JS+CSS)  │  │ ←── SSE ───────────│  │ - SSE Broadcaster      │ │
│  └────────────────┘  │                    │  │ - Approval Detector    │ │
│  ┌────────────────┐  │                    │  │ - tmux Driver          │ │
│  │ ServiceWorker  │  │                    │  └─────────┬──────────────┘ │
│  │ (Push, Cache)  │  │                    │            │ child_process  │
│  └────────────────┘  │                    │            ▼                │
└──────────────────────┘                    │  ┌────────────────────────┐ │
                                            │  │ tmux session           │ │
                                            │  │  ├─ window 0: claude   │ │
                                            │  │  ├─ window 1: claude   │ │
                                            │  │  └─ window 2: claude   │ │
                                            │  └────────────────────────┘ │
                                            └─────────────────────────────┘
```

## 2.2 各コンポーネントの責務

### 2.2.1 Node.jsサーバ（Mac上）

| 責務 | 内容 |
|------|------|
| HTTP API | クライアントからのコマンド受付（入力送信、承認応答、認証等） |
| SSE Broadcaster | サーバからクライアントへの一方向プッシュ（出力、状態変化） |
| tmux Driver | `tmux`コマンドのラッパー。`send-keys`、`list-windows`、`pipe-pane`等を呼ぶ |
| Approval Detector | 各ウィンドウの出力末尾を監視し、承認プロンプトのregexマッチで状態遷移 |
| Output Tailer | tmux `pipe-pane`で吐かれたファイルをtail-fして差分をin-memory ring bufferに格納。`pipe-pane`設定は`~/.tmux.conf`に焼いて永続化（サーバ停止中も記録継続） |
| Backfill | サーバ起動時に各windowで`tmux capture-pane -p -S -2000`を発行し、スクリーンバッファ末尾を取得してring buffer初期化に利用（既存windowの「サーバ起動前」を補完） |
| Auth | PIN照合、セッショントークン発行 |
| Push Sender | 承認待ち遷移時にWeb Pushを送る（VAPID） |
| Workspaces Loader | `data/workspaces.json` を読み込み、ランチャー定義を提供（spec/03 §3.5） |

### 2.2.2 PWAクライアント

| 責務 | 内容 |
|------|------|
| App Shell | UI描画、ユーザ操作受付 |
| EventSource | SSE接続・再接続管理 |
| Fetch API | コマンド送信 |
| Service Worker | キャッシュ、Push受信、通知表示 |
| State Store | 各ウィンドウの状態とログをin-memoryで保持 |

## 2.3 ファイル / モジュール構成

```
cc-pocket/
├── package.json              # name, scripts のみ。dependencies空
├── server/
│   ├── index.js              # エントリ。HTTPサーバ + 起動処理
│   ├── tmux.js               # tmux Driver（CLI呼び出しラッパー）
│   ├── tailer.js             # pipe-pane出力のtail監視
│   ├── detector.js           # 承認プロンプト検知（パターン定義は data/patterns.json）
│   ├── state.js              # ウィンドウ・セッションのin-memoryストア
│   ├── sse.js                # SSE Broadcaster
│   ├── auth.js               # PIN認証 + トークン管理
│   ├── push.js               # Web Push送信（VAPID）
│   └── routes.js             # ルーティング定義
├── public/
│   ├── index.html            # 全UIを内包
│   ├── app.js                # クライアントロジック
│   ├── style.css             # スタイル
│   ├── sw.js                 # Service Worker
│   └── manifest.webmanifest  # PWAマニフェスト
├── data/
│   ├── patterns.json         # 承認検知regex（Discovery後に埋める）
│   └── pin.txt               # gitignore対象。PIN（平文 or ハッシュ）
│
│  ※ ランタイムデータ（pipe-paneログ等）はリポジトリ外の
│    `~/.cc-pocket/pipe/<window_id>.log` に保存（Q14決定）。
│    tmux.conf の hook で永続記録されるため、サーバ停止中も追記が継続する。
├── scripts/
│   └── setup.sh              # 初回セットアップ補助
└── README.md
```

**設計原則**:
- 外部依存ゼロ（Node.js標準モジュール `http`, `https`, `fs`, `child_process`, `crypto`のみ）
- 1ファイルあたり300行を超えないように分割
- データ（regexパターン、PIN）はコードから分離

## 2.4 シーケンス: ウィンドウ初期化

```
PWA              Server              tmux
 │                  │                  │
 │ GET /windows     │                  │
 │─────────────────→│                  │
 │                  │ list-windows     │
 │                  │─────────────────→│
 │                  │←─────────────────│
 │                  │ pipe-pane (各w)  │
 │                  │─────────────────→│
 │←──── 200 ────────│                  │
 │                  │                  │
 │ GET /events SSE  │                  │
 │─────────────────→│                  │
 │←─ event: snapshot│                  │
 │                  │                  │
```

## 2.5 シーケンス: 出力配信

```
tmux pipe-pane → ~/.cc-pocket/pipe/<window_id>.log
                      │
                      ▼ (fs.watch / tail-f)
                  Tailer
                      │
                      ▼
                  Detector ─→ patterns match ─→ State遷移
                      │
                      ▼
                   State Store
                      │
                      ▼
                 SSE Broadcaster ─→ PWA
```

## 2.6 シーケンス: 入力送信

```
PWA              Server              tmux
 │                  │                  │
 │ POST /windows/0/input               │
 │ {text: "yes"}    │                  │
 │─────────────────→│                  │
 │                  │ send-keys -t 0   │
 │                  │ "yes" Enter      │
 │                  │─────────────────→│
 │←──── 200 ────────│                  │
 │                  │                  │
 │ (出力はSSE経由で別配信)              │
```

## 2.7 シーケンス: 承認応答

```
PWA              Server              tmux
 │                  │                  │
 │ (承認バナー表示中)                  │
 │ POST /windows/0/approve             │
 │ {action: "yes"}  │                  │
 │─────────────────→│                  │
 │                  │ send-keys "y" CR │
 │                  │─────────────────→│
 │                  │ State → streaming│
 │←─ event: state ──│                  │
```
