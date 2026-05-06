# 08. Runbook（セットアップ・運用）

## 8.1 前提条件

- macOS（M1+ 推奨）
- Node.js v20+
- tmux 3.3+（`brew install tmux`）
- Claude Code CLI インストール済み
- Tailscaleアカウント作成済み、Mac・スマホ両方にインストール済み

## 8.2 初回セットアップ

### 8.2.1 リポジトリ取得

```bash
cd ~/Projects
git clone <repo-url> cc-pocket
cd cc-pocket
npm install   # 依存ゼロ方針なので実質は scripts設定のみ
```

### 8.2.2 PIN設定

```bash
node scripts/set-pin.js
# プロンプトで4桁PINを入力 → data/pin.json にハッシュ保存
```

### 8.2.3 Web Push VAPIDキー生成（任意）

```bash
node scripts/gen-vapid.js
# data/vapid.json に公開鍵・秘密鍵保存
```

通知不要なら省略可。

### 8.2.4 tmux設定の永続化（A+B方式）

`~/.tmux.conf` に以下を追記し、tmuxセッションが新規windowを作るたびに自動で`pipe-pane`がフックされるようにする（CC Pocketサーバ停止中も記録継続）:

```tmux
# CC Pocket: pipe-pane permanent recording for cc-pocket session
set-hook -g session-window-created 'if -F "#{==:#{session_name},cc-pocket}" "pipe-pane -O \"cat >> #{HOME}/.cc-pocket/pipe/#{window_id}.log\""'
set-hook -g window-pane-changed   'if -F "#{==:#{session_name},cc-pocket}" "pipe-pane -O \"cat >> #{HOME}/.cc-pocket/pipe/#{window_id}.log\""'
```

リロード:
```bash
tmux source-file ~/.tmux.conf
mkdir -p ~/.cc-pocket/pipe
```

これでCC Pocketサーバが停止していても、tmux内のClaude Code出力は`~/.cc-pocket/pipe/<window_id>.log`に追記され続ける。

サーバ起動時には:
- `~/.cc-pocket/pipe/` のログを読んでring buffer初期化（A: 永続記録の活用）
- 各windowで`tmux capture-pane -p -S -2000`を発行して末尾補完（B: 起動時補完）
- 両方をマージして「サーバ停止中の出力 + サーバ起動前から動いてた既存window」を網羅

### 8.2.5 Tailscale確認

```bash
tailscale status
tailscale ip -4   # 100.x.x.x が出ればOK
```

スマホ側もTailnetに参加していることを確認（Tailscale管理画面）。

### 8.2.6 PWAアイコン用画像配置

```
public/
├── icon-192.png
├── icon-512.png
└── icon-maskable.png
```

なければ単色の代用アイコンを用意（実装時に選定）。

## 8.3 日次起動

### 8.3.1 サーバ起動

```bash
cd ~/Projects/cc-pocket
npm start
```

出力例:
```
[CC Pocket] Tailscale IP: 100.64.1.23
[CC Pocket] Listening on http://100.64.1.23:7000
[CC Pocket] tmux session: cc-pocket (windows: 0)
[CC Pocket] PIN: 4-digit (set in data/pin.json)
[CC Pocket] Open from phone: http://100.64.1.23:7000
```

### 8.3.2 Claude Codeを起動（tmuxセッション内）

別ターミナルから:
```bash
tmux attach -t cc-pocket
# window 0 に切り替えて
claude
```

または、サーバが新規windowで自動起動するモードを後で実装可（v1スコープ外）。

### 8.3.3 スマホからアクセス

1. Tailscale ON確認
2. ブラウザで `http://100.64.1.23:7000` にアクセス
3. 初回はホーム画面に追加（PWAインストール）
4. PIN入力
5. メイン画面表示

### 8.3.4 停止

サーバターミナルで `Ctrl+C`。tmuxセッションは残る。

## 8.4 検証チェックリスト（起動後）

- [ ] スマホから接続成功（PIN通過してメイン画面）
- [ ] Macで `echo hello` をtmuxに送る → スマホで見える
- [ ] スマホから `pwd\n` 送信 → Macで実行される
- [ ] Quick Keyの `Esc` 送信 → Macで反映
- [ ] サーバ再起動 → 過去ログ末尾が再表示される

## 8.5 トラブルシューティング

### 8.5.1 サーバが起動しない

| 症状 | 原因 | 対処 |
|------|-----|------|
| `Tailscale IP not found` | Tailscale未起動 | Mac側で起動。`tailscale up` |
| `tmux session not found` | tmux未起動 | `tmux new -s cc-pocket -d` で先に作る |
| `EADDRINUSE` | ポート占有 | `lsof -i :7000` で確認、別ポート起動 |

### 8.5.2 スマホから接続できない

| 症状 | 原因 | 対処 |
|------|-----|------|
| タイムアウト | スマホ側Tailscale OFF | スマホでTailscale起動 |
| Connection refused | サーバが`127.0.0.1`にbind | `tailscale ip -4` 結果を確認、bindアドレス見直し |
| 証明書エラー | HTTPS設定？ | v1はHTTP前提（Tailscale暗号化に依存） |

### 8.5.3 出力が流れない

| 症状 | 原因 | 対処 |
|------|-----|------|
| 何も表示されない | pipe-pane失敗 | `tmux pipe-pane -t cc-pocket:0` 状態確認 |
| 一部のwindowだけ流れない | 該当windowのpipeファイル不在 | サーバ再起動でpipe-pane再設定 |

### 8.5.4 承認バナーが出ない

v0実装ではバナーは出ない（マニュアルモード）。Quick Keysで `y` `n` を送る運用。

v1実装後に出ない場合は:
- `data/patterns.json` のバージョンとClaude Code実バージョンの整合性確認
- 該当出力を `data/samples/regression/` に追加してregex調整

### 8.5.5 PINロック解除

- 10分待つ
- または `data/pin-lockout.json` を削除（v1ではin-memoryなのでサーバ再起動でリセット）

## 8.6 アップグレード手順

```bash
cd ~/Projects/cc-pocket
git pull
npm install
# patterns.jsonの差分確認
git diff HEAD~ data/patterns.json
npm start
```

## 8.7 完全リセット

```bash
# tmuxセッション削除
tmux kill-session -t cc-pocket
# pipeファイル削除
rm -rf ~/.cc-pocket/pipe/*
# データリセット
rm data/pin.json data/vapid.json
# 再セットアップから
node scripts/set-pin.js
```

## 8.8 バックアップ

- `data/` ディレクトリのみバックアップ対象
- pipe-paneログは揮発でOK
- `data/samples/` はDiscovery資産。別リポジトリ or クラウド保管推奨
