# 07. 非機能要件・脅威モデル

## 7.1 性能要件

| 指標 | 目標 | 計測条件 |
|------|------|---------|
| 出力配信レイテンシ | p50 < 200ms / p95 < 500ms | 自宅WiFi、Tailnet経由 |
| 入力反映レイテンシ | p50 < 300ms / p95 < 800ms | POST受信 → tmux→出力エコー |
| ウィンドウ切替レイテンシ | < 300ms | UI切替（ログ再描画含む） |
| SSE再接続復帰時間 | < 5s | 切断検知から最初の出力受信まで |
| 起動時間（サーバ） | < 2s | `npm start` → HTTP listen完了 |
| 接続時間（クライアント） | < 3s | URL叩く → 最初の出力表示 |

## 7.2 リソース予算

| 指標 | 上限 |
|------|------|
| サーバRSS | 200MB |
| サーバCPU定常時 | < 5% (M1 Mac基準) |
| Per-window メモリ | 4MB（ring buffer等含む） |
| pipe-paneファイル | 各10MB（ローテーション） |
| クライアントメモリ | 100MB（ログ保持・PWAキャッシュ含む） |

## 7.3 可用性

- 自分専用ツール、SLOなし
- 計画停止: サーバ再起動はいつでもOK（tmuxセッションは残るため作業継続可能）
- データロス許容: in-memory ログは消えてもよい（pipe-paneファイルから復元）

## 7.4 互換性

| 項目 | サポート |
|------|--------|
| サーバOS | macOS 14+ (M1/M2/M3/M4) |
| Node.js | v20 LTS+ |
| tmux | 3.3+ |
| クライアントOS | iOS 16.4+ / Android 12+ |
| ブラウザ | Mobile Safari / Chrome (PWA対応必須) |
| Claude Code | discoveryで使用したバージョン（patterns.jsonに記録） |

## 7.5 脅威モデル

### 7.5.1 In Scope（v1で対策する）

| ID | 脅威 | 対策 |
|----|------|-----|
| T1 | インターネット経由の不正アクセス | Tailscaleで物理的に到達不可。グローバルIPでlistenしない |
| T2 | Tailnet内デバイス乗っ取り（紛失したスマホ等） | PIN認証 + 5回失敗ロック |
| T3 | localStorageのトークン窃取 | トークン24h期限 / `httpOnly`は使えないが、自分専用前提でリスク受容 |
| T4 | SSEストリームの覗き見 | TailscaleがWireGuardで暗号化、HTTPS不要 |
| T5 | tmuxセッションへの意図しないコマンド送信 | per-window queueで直列化、approvalIdで古い承認応答を弾く |
| T6 | PIN総当り | 5回失敗で10分ロック、PINファイルはハッシュ保存 |
| T7 | 承認誤検知による意図しない実行 | False Positive < 1%基準（05章）、暫定はマニュアルモード |

### 7.5.2 Out of Scope（v1では対策しない）

| 脅威 | 受容理由 |
|------|---------|
| Macそのものの物理アクセス | 自宅前提、別レイヤで対策 |
| Claude Code自体の脆弱性 | 上流対応 |
| Mac内の他プロセスからのpipeファイル読み取り | macOSファイルシステム権限に依存、ユーザ単独利用前提 |
| ネットワーク中間者攻撃 | Tailscale任せ |
| サプライチェーン攻撃 | 外部依存ゼロ方針で軽減 |

## 7.6 セキュリティ実装要件

### 7.6.1 PIN

- 4桁数字。平文保存しない
- 保存形式: `scrypt(pin, salt)` のハッシュ + salt を `data/pin.json` に保存
- ハッシュ計算は`crypto.scryptSync`を使用、cost params: N=2^14, r=8, p=1
- 比較は`crypto.timingSafeEqual`

### 7.6.2 トークン

- 32バイト乱数を`crypto.randomBytes`で生成、Base64URL
- サーバin-memoryに `Map<token, {expiresAt, createdAt}>` で保持
- 期限切れトークンは10分ごとのGCで削除
- ログアウト用エンドポイント: POST `/auth/logout` で即時invalidate

### 7.6.3 PINロック状態

- in-memoryで `{failedAttempts, lockedUntil}` を保持
- サーバ再起動でリセット（自分専用前提のため許容）

### 7.6.4 listen設定

- 既定: `127.0.0.1` ではなく Tailscale IP（`100.x.x.x`）にbind
- 起動時にTailscale IPを検出（`tailscale ip -4`）
- 検出失敗時は起動失敗 → ユーザにTailscale起動を促す

### 7.6.5 CSP

- `index.html` に厳格なContent-Security-Policy
- `default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:;`
- 外部CDN等は使わない（依存ゼロ方針と整合）

### 7.6.6 入力検証

- POST `/windows/:id/input` の `text` は最大8KB
- POST `/windows/:id/keys` の `keys` はホワイトリスト方式
  - 許可: `[a-zA-Z0-9]`単一文字、`Enter`, `Escape`, `Tab`, `Up`, `Down`, `C-c`, `C-d`, `C-z` 等のtmux標準キー名
  - それ以外は400拒否
- `:id` は `^\d+$` で検証

### 7.6.7 ログ

- アクセスログ: 最低限（method, path, status, ms）。tokenは記録しない
- エラーログ: スタックトレース込み、PIN/tokenはマスク

## 7.7 プライバシー

- Claude Codeの出力には機密情報が含まれる前提
- 通知本文に出力末尾を載せる場合、最大80文字まで
- 通知本文に「APIキー」「password」「secret」等の文字列が含まれた場合、本文を「承認待ち」のみに置換するスクリーニング
