# 03. データモデル・API契約

## 3.1 データモデル

### 3.1.1 Window

```typescript
interface Window {
  id: string              // tmux window index "0", "1", ... (文字列で扱う)
  name: string            // tmux window name (例: "main", "feature-x")
  state: WindowState      // 後述
  lastActivityAt: number  // epoch ms。最後の出力イベントタイムスタンプ
  approval: Approval | null  // 承認待ちのときのみ設定
  outputBytes: number     // 累積出力バイト数（メトリクス用）
}

type WindowState = 'idle' | 'streaming' | 'awaiting_approval' | 'error'

interface Approval {
  detectedAt: number      // epoch ms
  patternId: string       // 一致したpatterns.jsonのid
  prompt: string          // 検知前後の出力末尾抜粋（最大500文字）
  options: ApprovalOption[]
}

interface ApprovalOption {
  label: string           // ボタンに出す日本語 (例: "許可")
  keystroke: string       // 送るキー入力 (例: "y\r", "1\r")
  isDefault: boolean      // Enterキー単体で選ばれる選択肢
}
```

### 3.1.2 OutputChunk（SSEで配信される出力差分）

```typescript
interface OutputChunk {
  windowId: string
  seq: number             // 単調増加。クライアントが欠落検知に使う
  text: string            // ANSIエスケープ含むそのまま
  timestamp: number       // epoch ms
}
```

### 3.1.3 SessionInfo（クライアントがGET /sessionで取得）

```typescript
interface SessionInfo {
  serverVersion: string
  tmuxSession: string     // 例: "cc-pocket"
  startedAt: number
  windows: Window[]
}
```

## 3.2 HTTP API

すべてのエンドポイントは `Authorization: Bearer <token>` を要求。`/auth/pin`のみ例外。

### 3.2.1 POST /auth/pin

PIN検証 → セッショントークン発行。

**Request**:
```json
{ "pin": "1234" }
```

**Response 200**:
```json
{ "token": "<opaque>", "expiresAt": 1735689600000 }
```

**Response 401**: `{ "error": "invalid_pin", "remainingAttempts": 4 }`
**Response 429**: `{ "error": "locked", "unlockAt": 1735690000000 }` (5回失敗後10分ロック)

### 3.2.2 GET /session

現在のサーバ状態スナップショット。

**Response 200**: `SessionInfo`

### 3.2.3 GET /windows/:id/log?since=<seq>

ウィンドウの過去ログ。`since`未指定で直近2000行。

**Response 200**:
```json
{ "windowId": "0", "chunks": [OutputChunk, ...], "truncated": false }
```

### 3.2.4 POST /windows/:id/input

通常入力送信。

**Request**:
```json
{ "text": "review this PR\n" }
```

`text`末尾の改行はそのままtmuxに送られる。改行なしなら追加しない（呼び出し側責任）。

**Response 200**: `{ "ok": true }`
**Response 409**: `{ "error": "awaiting_approval" }` （承認待ち中の通常入力は拒否）

### 3.2.5 POST /windows/:id/approve

承認応答送信。

**Request**:
```json
{ "approvalId": "<detectedAt>", "action": "yes" | "no" | "always" }
```

`approvalId`はクライアントが受け取った`Approval.detectedAt`をそのまま返す（古い承認への誤応答を防ぐ）。

**Response 200**: `{ "ok": true }`
**Response 410**: `{ "error": "stale_approval" }` （既に解決済みの承認に応答）

### 3.2.6 POST /windows/:id/keys

生キーストローク送信（v1ではESC、Ctrl+C等の救援用）。

**Request**:
```json
{ "keys": "C-c" }
```

`keys`はtmuxの`send-keys`記法に従う。

**Response 200**: `{ "ok": true }`

### 3.2.7 POST /push/subscribe

Web Push購読登録。

**Request**: 標準のPushSubscription JSON。
**Response 200**: `{ "ok": true }`

## 3.3 SSE: GET /events

**Headers**:
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`

接続時にqueryで `lastSeq` を渡せば、それ以降のイベントから配信再開（再接続時のロスを最小化）。

### 3.3.1 イベント種別

```typescript
type SseEvent =
  | { type: 'snapshot'; data: SessionInfo }       // 接続直後に1回
  | { type: 'output'; data: OutputChunk }
  | { type: 'state'; data: { windowId: string; state: WindowState; approval?: Approval } }
  | { type: 'window_added'; data: Window }
  | { type: 'window_removed'; data: { windowId: string } }
  | { type: 'ping'; data: { timestamp: number } } // 30秒ごとのkeep-alive
```

### 3.3.2 ワイヤフォーマット例

```
event: output
id: 12345
data: {"windowId":"0","seq":12345,"text":"Read 53 lines\n","timestamp":1735689600100}

event: state
id: 12346
data: {"windowId":"0","state":"awaiting_approval","approval":{...}}

event: ping
data: {"timestamp":1735689630000}
```

`id`はSSEの`Last-Event-ID`機構で再接続時のレジューム用。サーバ側は単調増加`seq`をそのまま使う。

## 3.5 Workspaces API

`data/workspaces.json` に手動定義したプロジェクトランチャー。タップ 1 回で `tmux new-window -c <path>` + 起動コマンドを発行。

### 3.5.1 GET /workspaces

**Response 200**:
```json
{
  "workspaces": [
    { "name": "cc-pocket", "path": "/Users/.../cc-pocket", "command": "claude --resume" }
  ]
}
```

**Response 503**: `{ "error": "workspaces_not_configured" }` — `data/workspaces.json` 不在 or 不正 JSON。

### 3.5.2 POST /workspaces/open

**Request**: `{ "name": "cc-pocket" }`

**Response 200**: `{ "ok": true, "windowId": "@5", "name": "cc-pocket" }`

**Response 400**: `{ "error": "bad_request" }`
**Response 404**: `{ "error": "workspace_not_found" }`
**Response 503**: `{ "error": "tmux_unavailable", "message": "..." }`

副作用: `tmux new-window -t cc-pocket -c <expanded path> -P -F '#{window_id}'` で window 作成 → 100ms 待ち → `send-keys -l '<command>'` → `send-keys Enter`。同名 workspace の複数タップは複数 window を生む（モデル B = ランチャー型）。

### 3.5.3 workspaces.json スキーマ

```typescript
interface WorkspaceFile {
  workspaces: Workspace[]
}

interface Workspace {
  name: string             // ユニーク。UI での表示名
  path: string             // 絶対パス or `~` 展開可
  command?: string         // 既定: "claude --resume"
}
```

`name` 重複は不可（ロード時に拒否）。`path` は server プロセスの `os.homedir()` で `~` 展開する。

## 3.6 Recent Sessions API

`~/.claude/projects/<encoded-path>/<sessionId>.jsonl` を scan して直近のセッション一覧を返す。

### 3.6.1 GET /sessions/recent

**Query**: `?limit=10`（既定 10、min 1, max 50, clamp）

**Response 200**:
```json
{
  "sessions": [
    {
      "sessionId": "03f2fd54-4da5-4ebe-a8e1-bfdb88dd2404",
      "projectPath": "/Users/.../cc-pocket",
      "projectName": "cc-pocket",
      "mtime": 1735689600000,
      "firstUserMessage": "こんにちは…"
    }
  ]
}
```

**Response 503**: `{ "error": "claude_history_not_found" }` — `~/.claude/projects/` 不在。

`firstUserMessage` は null の場合あり（パース失敗 / user メッセージなし）。最大 80 文字 truncate。

### 3.6.2 POST /sessions/open

**Request**: `{ "projectPath": "/Users/.../cc-pocket", "sessionId": "<uuid>" }`

**Response 200**: `{ "ok": true, "windowId": "@6" }`
**Response 400**: `{ "error": "bad_request", "reason": "invalid_path" | "invalid_session_id" }`
**Response 503**: `{ "error": "tmux_unavailable" }`

セキュリティ: `projectPath` は絶対パス必須、`..` を含むパスは拒否、`os.homedir()` 配下のみ許可。`sessionId` は `^[a-f0-9-]{36}$`（UUID 形式）必須。

副作用: `tmux new-window -c <projectPath>` → 100ms 待ち → `send-keys -l 'claude --resume <sessionId>'` → `send-keys Enter`。

## 3.7 patterns.json（承認検知パターン定義）

```typescript
interface PatternFile {
  version: number          // 1, 2, ...（破壊的変更時にbump）
  patterns: Pattern[]
}

interface Pattern {
  id: string               // 例: "yn_prompt_v1"
  description: string
  regex: string            // JavaScriptのRegExp互換。末尾マッチ前提（$不要、Tailerが末尾チャンク渡す）
  flags: string            // 例: "m"
  options: ApprovalOption[]
  windowSize: number       // 何バイト末尾を見るか（例: 2000）
}
```

実際のregex内容は `05-approval-detection.md` のDiscovery TODO完了後に埋める。
