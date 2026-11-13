# Logo

## jpg
![](./jpg/dak_logo.jpg)

## png
![](./png/dak_logo.png)

## svg
![](./svg/dak_logo.svg)

### logotype
![](./svg/dak_logotype.svg)

## Motion

`motion/` は [Remotion](https://www.remotion.dev/)（TypeScript + React）で作ったモーションロゴのプロジェクトです。
ロゴは `svg/dak_logo.svg` から 1000×1000 の座標系に平坦化して React コンポーネント化しており（`motion/scripts/extract-logo.ts`）、
枠（ブルーシート）・4つのペグ（ハトメ）・"Dance at" / "Kamogawa" の各グリフを個別にアニメーションできます。

コンセプト: **何もないところからイベントをはやす**。四角はブルーシート、四隅の輪は地面に打ち込んだハトメ。

### パターン

すべて 60fps、BPM グリッド（デフォルト 140 BPM、Studio で `bpm` を変えると尺も追従）で動きます。
各パターンは `-Square`（1080×1080）と `-Wide`（1920×1080）の2サイズ。

| パターン | 尺 (140 BPM) | 内容 |
| --- | --- | --- |
| **Genesis** | 22拍 / 約9.4秒 | 何もない画面に点がポンと生まれ → 細胞分裂して2つに → スピーカーになって拍に合わせて鳴り、音の輪を出す → 鴨川・高野川を下る紆余曲折の旅で出町の三角州（Y字）へ → もう一度分裂して四隅に飛び、ペグとして着地 → ブルーシートが広がって枠が描かれる → タイプライター風に "Dance at" "Kamogawa" が打たれる → ペグが拍で脈打つ |
| **Delta** | 13拍 / 約5.6秒 | 2本の川が上から描かれて Y 字に合流 → 合流点に点 → 波紋が広がり、最後の波紋が四角いシートになる → ペグが落ちてきて、文字がせり上がる |
| **TarpDrop** | 10拍 / 約4.3秒 | ブルーシートがひらひら落ちてきてバウンド着地 → 1拍に1本ずつペグを打ち込む → 文字がスタンプされる |
| **BeatLoop** | 4小節 / 約6.9秒 | VJ 用シームレスループ。ペグと枠が拍で脈動し、ペグから音の輪が出る。デフォルトは白・透過 |
| **Stinger** | 4拍 / 約1.7秒 | SNS 用の短いイントロ/アウトロ。`outro: false` で最後をロゴのまま止める |
| **Liquid** | 24拍 / 約10.3秒 | 黒地にツヤのある半透明アクアの水（WebGL）。ガラスのような水滴がスローでひとつ落ちてくる → 周りから水滴が集まってメタボールのように合体 → ダウンビートでスプラッシュ（王冠状のトゲと飛び散る水滴） → 細いグレーの枠（ブルーシート）が描かれる → 水滴が4つ四隅に飛んでガラス玉のハトメになる → 水たまりに落ち着き、その*下*から "Dance at / Kamogawa" が浮かぶ（水越しに屈折して見える） → 拍に合わせて水が呼吸 |
| **LiquidLoop** | 4小節 / 約6.9秒 | Liquid の最終状態の VJ 用シームレスループ。水たまりが拍で呼吸し、波紋が広がり、水滴が漂う |

共通プロップ（Studio の右パネルで編集可）: `preset`（`ink` = #3f3f3f/白地, `white` = 白/透過, `tarp` = 白/ブルーシートの青 #1f5fb4）、
`color` / `background`（プリセットの上書き。`background` は `transparent` 可）、`bpm`、`logoScale`。

Liquid / LiquidLoop のプロップ: `bpm`、`liquidColor`（水の色、デフォルト #6fd3cd）、`textColor`（文字とハトメ、#c8c8c8）、
`frameColor`（細い枠、#9a9a9a）、`background`（#000000）、`logoScale`（0.66）。

Liquid は three.js（`@remotion/three`）のフルスクリーンシェーダーで描いています。水は 2D の符号付き距離場（メタボール的に滑らかに結合した
水たまり・触手・水滴）を高さに持ち上げた「2.5D」で、屈折（色収差つき）・吸収/散乱・フレネル反射（手続き的なスタジオ照明）・
スペキュラ・コースティクスをシェーダーで計算します。ロゴ（枠・ハトメ・文字）は水の下のキャンバスに描かれ、水越しに屈折して見えます。
すべてフレーム番号から決まる決定的な計算です（乱数はシード付き）。

### 使い方

```sh
cd motion
pnpm install
pnpm dev                 # Remotion Studio
pnpm typecheck
pnpm render --list       # レンダリング一覧
pnpm render              # すべて motion/out/ に書き出し
pnpm render --only=genesis,stinger   # ファイル名で絞り込み
pnpm stills Genesis-Square /tmp/stills 0,120,last   # 静止画チェック
pnpm extract             # SVG を更新したらジオメトリを再生成
```

Chrome Headless Shell をダウンロードできない環境では `REMOTION_BROWSER_EXECUTABLE=/path/to/chromium` を指定してください。
Liquid は WebGL を使います。デフォルトは `swangle`（ANGLE + SwiftShader のソフトウェア描画。GPU のない CI でも動く）で、
GPU のあるマシンでは `REMOTION_GL=angle` を指定すると速くなります（`remotion.config.ts` も同じ環境変数を見ます）。
目安: 4コアの GPU なし環境で 1080×1080 が約 0.34 秒/フレーム、1920×1080 が約 0.3〜0.5 秒/フレーム（`pnpm render` がジョブごとに ms/frame を表示します）。
HAP 変換には `ffmpeg`（hap エンコーダ付き）が必要です。

### 書き出しファイル（`motion/out/`）

- `dak-{genesis,delta,tarp-drop,beat-loop,stinger}-{1080x1080,1920x1080}-ink.mp4` — H.264
- `dak-genesis-1920x1080-white-alpha.mov` — ProRes 4444 + アルファ（`yuva444p10le`）
- `dak-beat-loop-1920x1080-white-alpha.mov` — ProRes 4444 + アルファ（シームレスループ）
- `dak-beat-loop-1920x1080-white-hap-alpha.mov` — HAP Alpha（Resolume 用）
- `dak-stinger-540x540-ink.gif` — GIF
- `dak-liquid-{1080x1080,1920x1080}.mp4` — Liquid、H.264
- `dak-liquid-loop-1920x1080.mp4` — LiquidLoop、H.264（シームレスループ）
- `dak-liquid-loop-1920x1080-hap.mov` — LiquidLoop、HAP（アルファなし。黒地なので Resolume ではスクリーン/加算合成で抜けます）

### リリース

タグを push すると GitHub Actions（`.github/workflows/motion-release.yml`）が全パターンをレンダリングし、GitHub Release に添付します。

```sh
git tag motion-v1.0.0 && git push origin motion-v1.0.0
```

Actions タブから手動実行（workflow_dispatch）した場合は、Release ではなくワークフローのアーティファクトとしてアップロードされます。

### ライセンスについて

Remotion は個人および従業員3人以下の団体なら無料で使えます。それ以上の規模の会社で使う場合は Company License が必要です（[remotion.dev/license](https://www.remotion.dev/license)）。
