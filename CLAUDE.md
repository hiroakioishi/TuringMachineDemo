# CLAUDE.md

チューリングマシンの動作を可視化・体験するデモプロジェクト。

## ドキュメント

| ファイル | 内容 |
|---|---|
| [notes/仕様.md](notes/仕様.md) | デモの仕様（目的・機能・画面・対象） |
| [notes/進捗.md](notes/進捗.md) | 進捗ログ・TODO・決定事項 |
| [notes/テクだし.md](notes/テクだし.md) | 技術候補・表現アイデアの洗い出し |

## 作業ルール

- 作業を始める前に `notes/進捗.md` と `notes/仕様.md` を読み、現状を把握する。
- 作業の区切りごとに `notes/進捗.md` を更新する（日付・やったこと・次にやること）。
- 仕様が変わった、または決まったときは `notes/仕様.md` に反映する。未確定の項目は「未定」と明記する。
- 技術を選んだ・却下したときは、理由と合わせて `notes/テクだし.md` に残す。
- ドキュメントは日本語で書く。

## 技術スタック

- 素の HTML / CSS / JavaScript（ES モジュール）。ビルド不要、外部ライブラリなし。
- 公開先は GitHub Pages（リポジトリのルートをそのまま公開。`.nojekyll` あり）。
- ローカル実行: `python -m http.server 8000` → http://localhost:8000/
- テスト: `npm test`（Node.js 組み込みのテストランナー。`tests/*.test.js`）

## コード構成

- `js/machine.js` — コアロジック（`compile` で検証・変換、`TuringMachine` で実行・巻き戻し）。DOM に依存させない。
- `js/presets.js` — 例題。追加したら `tests/machine.test.js` に期待値のテストを足す。
- `js/render.js` — Canvas 描画（テープとヘッド、時空間図）
- `js/diagram.js` — 状態遷移図（SVG）。例題の `layout` → 自動配置（開始状態からの距離で列分け）の順に配置する。ドラッグで `def.layout` を書き換える
- `js/main.js` — UI 全般（操作、遷移表エディタと行の並べ替え、共有リンク `#m=<base64url JSON>`。JSON には `layout` も入る）
- **キャッシュ対策**: JS / CSS を変更したら、`index.html` と `js/main.js` の import にある `?v=N` を 1 つ上げる（GitHub Pages ではモジュールがキャッシュされ、新旧のファイルが混ざると壊れるため）
- 画面の文言は日本語。対象は学習・説明用なので、専門用語には説明を添える。
