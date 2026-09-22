# 1枚から下地・閉眼・閉口を用意する

`./AUTO_RIG.command /path/to/character.png` で実行する。Codex CLI のログインと通常のセットアップが必要。差分は省略可能で、指定した差分を優先する。

Astra が通常画像を見て `reference.plan.json` と `work/reference_masks/*.png` を作り、Python がマスク内の塗り戻しと閉じ線の描画を行う。通常画像の外形・透明度・顔以外の画素は維持する。閉眼・閉口がすでに元絵にある場合は、その端点の絵を維持する。見えていない表情を復元できるわけではなく、閉じ線は推定結果となる。

- `checks/generated_references.png`: 4枚を並べた確認画像
- `work/generated_references/`: 自動生成したPNGと閉じ線マスク
- `work/generated_references/manifest.json`: 生成手法、元画像／プラン／マスクのハッシュ、変更画素数
- `reference.plan.json`: 目と口の領域、閉じ線、線幅、必要なら肌色・線色

Flat は顔のパーツを除いた下地。髪や衣装まで消した全身の隠れた絵を作るものではない。リグ工程で独立して動かすパーツをマスクで切り分ける。

## 調整して作り直す

キャラの作業フォルダでマスクや `reference.plan.json` の線を調整し、セットアップ済みのPythonで次を実行する。

```sh
python toolbox/normalize_inputs.py
python toolbox/generate_references.py
python toolbox/normalize_inputs.py
python toolbox/build_project.py
python toolbox/validate_character.py
```

プランや元画像、マスク、生成PNGのハッシュが変わったキャッシュは再利用しない。手描き差分を使う場合は `input/` に置いて `character.config.json` の対応する入力名を設定する。全差分の自動生成を止める場合は `auto_generate_references: false`。

元絵の肌に細かい模様や影、髪の重なりがある場合は塗り戻しに調整が必要になる。比較画像を見ながらマスクの範囲、閉じ線、線幅を直せる。自動生成の比較結果を通常のリグレビューにも渡す。
