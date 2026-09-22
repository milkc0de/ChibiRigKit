# ChibiRigKit

2Dパーツリグv14を、**任意のキャラクター画像から半自動で 2Dリグへ変換できる汎用プロジェクト**にしたものです。

自動で意味判断する部分は **Codex app-server + GPT-6 Astra / reasoning high** を使います。画像の位置合わせ・パーツ書き出し・プロジェクト生成・検証はローカルの決定論的な Python ツールで行い、Astra は「どこを何のパーツとして切るか」「マスクの汚染や重なりをどう直すか」「どのメッシュ/支点/描画順が自然か」を担当します。

## 入力画像

**通常画像1枚で始められます。** 足りない `flat`（顔の下地）、`blink`（閉眼）、`mouth_closed`（閉口）は、画像を解析して自動生成します。元画像は保持し、顔の指定領域だけを補完した派生画像を別に保存します。

手描きの差分がある場合は従来の `--flat` / `--blink` / `--mouth-closed` で指定でき、指定画像が優先されます。差分の画像サイズが違う場合は自動位置合わせします。

## 使い方

### 1. 初回セットアップ

```bash
cd ChibiRigKit
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
npm install
```

Codex CLI 側はログイン済みにしてください。

### 2. 画像1枚から自動リグ

```bash
./AUTO_RIG.command /path/to/character.png
```

`characters/character/` を作成し、差分生成→リグ作成→検証まで実行します。既存のキャラフォルダを渡して再開することもできます。

作成と実行を分けたい場合:

```bash
.venv/bin/python scripts/new_character.py --normal /path/to/character.png
npm run auto -- --character ./characters/character
```

名前を指定したければ `--name "My Character"` を追加します。

デフォルトは内部で `codex app-server` を起動し、`model/list` で **gpt-6-astra** と **high** が利用可能か確認してから実行します。どちらかが使えない場合は勝手に別モデルへ落とさず停止します。

すでに app-server を起動している場合:

```bash
CODEX_APP_SERVER_URL=ws://127.0.0.1:4500 \
  npm run auto -- --character ./characters/My-Character
```

リモート app-server を使う場合は `wss://` + Bearer token を推奨します。

### 3. プレビュー

```bash
npm run serve -- --character ./characters/character --port 8080
```

`http://127.0.0.1:8080/` を開きます。

## 自動処理の流れ

1. 通常画像を基準に、指定済みの差分を位置合わせ
2. 足りない差分があれば、Astra が目・口のマスクと閉じる線を計画
3. ローカル処理で下地・閉眼・閉口を生成し、比較画像を保存
4. Astra が意味パーツ、顔メッシュ、白目／黒目、9方向の配置を決定
5. Python がパーツ、`rig.project.json`、単独で開ける `dist/<キャラ名>/index.html` と `dist/<キャラ名>.zip` を生成（作業用プレビューは `work/player/index.html`）
6. 開眼／閉眼の再構築・差分画像とブラウザ描画を検証
7. Astra が検証画像を確認し、マスク・目位置・まつ毛・継ぎ目・重複を修正
8. 各レビュー後に描画を再検証し、失敗時は停止

自動差分は、元絵に存在しない表情を推定したものです。`checks/generated_references.png` に通常／下地／閉眼／閉口の比較を残します。仕上がりの調整方法は [docs/SINGLE_IMAGE.md](SINGLE_IMAGE.md) を参照してください。

## 瞬き

汎用ランタイムは パーツ分割型の構成です。

- 白目・黒目・まつ毛を分離できる（従来の一体型 Open 目も対応）
- 黒目は顔向き・視線に追従し、白目の内側で切り抜く
- Open 目メッシュを閉眼参考のラインへ変形
- 閉じた目の絵は通常 0% opacity
- ほぼ完全に閉じたところだけ閉眼画像を上から表示
- 開くときは逆順
- 頬の赤みは原則ベース側に残し、目パーツへ混ぜない

## メッシュ

プロジェクト JSON の `mesh.type` で共通ランタイムを使います。

- `blink_eye_radial`: 目
- `bend_vertical`: 髪・リボン・スカート
- `soft_body`: 胴・腕・脚
- `soft_strip`: 眉・口など
- `face_grid`: 顔と方向別の格子メッシュ

各キャラ固有の JavaScript を書かなくても、`rig.project.json` の意味役割だけで動きます。

## Codex に任せる範囲

Astra High は、固定座標や特定キャラ名に依存しないように次を決めます。

- パーツ数
- マスク形状
- 支点
- 前後関係
- 目の閉じライン
- 重なり幅
- 初期モーション
- 検証結果を見たマスク修正

`input/` は保持します。差分準備の後は `work/aligned/` も固定し、リグ作成中の元画像改変をハッシュで検知します。生成した差分は `work/generated_references/` に分けて記録します。

## 主なファイル

```text
scripts/new_character.py       新規キャラワークスペース作成
scripts/auto-rig.mjs           Codex app-server オーケストレーター
scripts/codex-app-server.mjs   JSON-RPC クライアント

template/workspace/
  AUTO_RIG_TASK.md             Astra 用の厳密な作業仕様
  character.config.json        キャラ入力/パーツ数の希望
  rig.plan.schema.json         Astra が作るプランの形式
  toolbox/normalize_inputs.py  画像位置合わせ
  toolbox/build_project.py     マスク→パーツ/プロジェクト生成
  toolbox/validate_character.py 再構築/差分検証
  toolbox/mask_ops.py          マスク加工ヘルパー
  runtime/index.template.html  汎用リグランタイム
```

## 注意

完全自動のセグメンテーションは絵柄によって難易度が変わります。そのため「AIが1回座標を出して終わり」ではなく、**Astra がローカルの検証画像を見ながらマスクを修正する反復工程**にしています。これがこのプロジェクトの自動化部分の中心です。


## v14の教訓の反映（2026-09-22）

目の放射状メッシュ、完全閉眼の切替、目・口の対応パーツの変換共有、口の連続変形、原画像の改変検知、描画順・ファイル参照・埋め込みJSON検査を共通処理に反映しました。下地の二重表示、髪への肌／衣装混入、反対側の靴、足先への過剰補完を作業仕様と検証に追加しています。

準備済みの補修／継ぎ目画像を扱えますが、LaMaモデルの自動取得・推論は含みません。

`npm test` は合成素材によるビルド／整合性テスト、続く `npm run test:runtime` は実際のChrome描画テストです（Python仮想環境を有効にしてください）。Chromeが必要です。既存キャラには新しいテンプレートは自動コピーされません。新しく作成するキャラに適用されます。


## 背景の変更

プレビューの「背景」欄で、元の背景・単色・画像・透明を切り替えられます。PNG/JPEG/WebPを選ぶと画像背景になり、切り抜き表示／全体表示を選べます。「元の背景に戻す」で解除できます。選択はこのブラウザ内に保存され、元画像や動きのJSONは変更しません。背景画像は保存用に長辺1600px以内へ縮小します。

透明部分の市松模様は確認用の表示で、描画キャンバスには入りません。背景の差し替え対象は `role: background` のレイヤーと、既存形式の `id: background` / `kind: static` です。キャラ本体を含む静止レイヤーは保持します。背景とキャラが一枚の不透明レイヤーにまとまっている場合は、先にリグ側で背景を分離してください。

## 顔メッシュ・黒目／白目・9方向の配置

顔の肌をメッシュ化し、白目・黒目・まつ毛を別々に扱えます。正面＋上下左右＋斜め4方向の配置を保存し、その間を滑らかにつないで顔を動かします。通常は体・髪などの揺れと瞬きに、ランダムな顔向きを重ねて再生します。「顔をぐるぐる動かす」は全方向のつながりを確認するプレビューです。

```sh
source .venv/bin/activate
python scripts/create-face-demo.py
npm run serve -- --character characters/face-turn-demo --port 8080
```

「首を支点に頭全体をランダムに動かす」で、顔・白目・黒目・閉じ目・髪・頭の飾りを共通の支点で回転させます。「ヨー・ピッチ・ロール」はヨー0〜25°・ピッチ0〜25°・ロール0〜15°（初期値12°・8°・6°）。顔配置の編集中は停止します。動きJSONの `settings.neck_sway` と `settings.neck_sway_degrees` に保存されます。支点は `rig.plan.json` の `neck_sway.pivot` で指定でき、省略時は顔の下端中央を使います。

「顔の動きの量」「黒目の動きの量」は、それぞれ0〜4倍で自動の動きを調整します。0は停止、1が従来の強さ、初期値は1.5です。体の揺れや手動の方向編集は変わりません。動きJSONの `settings.head_motion_amount` と `settings.gaze_motion_amount` に保存され、「揺れの初期値」で初期設定に戻せます。

「向き」を選び、「選択した方向の配置を編集」をONにすると、各パーツの位置・大きさ・傾きと、絵の上のメッシュの点を調整できます。「この配置を保存」はブラウザ内の保存、「9方向をJSON保存」は持ち運び用です。通常の「初期値」は保存した9方向を消しません。

ビルドの元データにも戻すには、キャラのディレクトリで次を実行します。

```sh
python toolbox/import_head_poses.py --file /path/to/head-poses.json
python toolbox/build_project.py
```

最初の9方向は調整用のたたき台です。キャラごとの「一番きれいな配置」は実際の絵を見ながら保存してください。360度の立体回転ではなく、正面付近の2D変形です。詳細は [docs/HEAD_POSES.md](HEAD_POSES.md)。

検証結果は、`npm test` が生成する `work/test-report.json` と、各キャラのブラウザ検証結果 `checks/runtime-report.json` で確認します。テストの成功だけでは見た目の良さは判断できないため、9方向の比較画像と実際の動きも確認してください。

## 長時間処理と途中再開

AI処理に固定30分の上限は設けません。30秒ごとに経過時間と最後の活動を表示し、`work/codex-run.json` にスレッドID・工程・ターンID・結果を保存します。接続が切れた場合は待ち続けずエラーを表示します。

```sh
./AUTO_RIG.command ./characters/character --resume
```

同じ作業履歴と既存ファイルを使い、途中成果を確認して残りの作業を進めます。旧版で中断し記録がない場合は `--resume-thread THREAD_ID` で履歴を指定します。別の実行がまだ動いている間は重ねて起動しないでください。

時間上限を明示したい場合は `--turn-timeout-minutes 120`、またはキャラ設定の `turn_timeout_minutes` を指定します。0が無制限です。指定上限に達した場合はターンの中断を要求し、再開用のIDを保存します。

## 全体の動きJSON

「全体の動きをJSON保存」→「全体の動きJSONを読み込む」で、同じキャラのパーツ／グループの揺れ、全体速度・量・ループ秒数、瞬き・口・視線、9方向の顔配置をまとめて復元します。従来の `rig.project.edited.json` も読み込めます。旧形式に保存されていなかった速度などは既定値になります。

読み込みはその場に反映し、別キャラ・画像構成の違い・不正値は適用前に拒否します。「初期値」はパーツ／グループと再生設定をHTML作成時に戻し、顔配置は維持します。変更を残す場合はJSONを保存してください。

既存キャラの共通ランタイム更新（置換ファイルは `work/template-backups/` に退避）:

```sh
.venv/bin/python scripts/update-character.py --character characters/character
cd characters/character
../../.venv/bin/python toolbox/build_project.py
```

## JSONでの作業契約とテスト

- `rig.workflow.json`: 入力座標、保護対象、工程ごとのアクション／必須成果物、実測結果の合格条件
- `rig.workflow.schema.json`: 作業契約の形式と不変条件
- `rig.result.schema.json`: Codexの終了結果（`ready_for_validation` / `blocked`、成果物、問題一覧）
- `work/phase-*.json`: 各工程の構造化結果
- `tests/test-cases.json`: テスト実行定義と検証範囲
- `work/test-report.json`: ローカルテストの機械可読な結果

オーケストレーターはJSONのタスクを渡し、モデルの返答を `outputSchema` で制約します。自然文の進捗は配信せず、ツール実行状況を表示します。モデルの完了宣言だけでは合格にせず、成果物の存在・元画像と実装の不変性・静止画／ブラウザ検査を別々に検証します。既存のMarkdown仕様は人間向け参考資料として保持しています。

```sh
npm test
```

Python環境は `.venv` を自動選択します。ブラウザ検証は各キャラで `node toolbox/validate_runtime.cjs`、対話表示は `runtime-check.html`。接続テストにはオフラインのapp-server代役を使い、実モデルの画質評価やブラウザ描画と区別しています。

### 結果JSONの記入テンプレート

`templates/results/` に `reference-planning.json`、`rigging.json`、`review.json`、`blocked.json` を同梱しています。各工程のタスクJSONに記入例も自動で渡します。`artifacts` は作成済みのファイル・ディレクトリの相対パスです（例: `work/masks/`）。工程の `required_outputs` は引き続きファイルとして検証し、フォルダで代用できません。

### キャラクターの動きテンプレート

ビルドすると、そのキャラのパーツ名が入った `motion.template.json` と検証用の `motion.schema.json` が揃います。画像データは含みません。`settings` で全体速度・量・ループ秒数、`parts.<パーツ名>` で `rot_deg`（回転振幅）、`x_px` / `y_px`（移動振幅）、`phase`（位相）、`freq`（周波数倍率）を指定できます。`groups` はグループ単位の動きです。

テンプレートはビルド時に再作成されるので、編集版は `motion.custom.json` など別名で保存してください。編集したJSONはブラウザの「全体の動きJSONを読み込む」で適用します。`layout_signature` とパーツ名は変更しないでください。ブラウザの保存ボタンも画像を含まない `motion.json` を出力し、9方向の顔配置も同梱します。`motion.template.json` は顔配置を省略しているため、読み込み時に現在の顔配置を維持します。従来の全プロジェクトJSONも読み込めます。

## 首振りの基準配置

`rig.plan.json` の `neck_sway.poses` はヨー×ピッチの9方向ごとのパーツ補正です。`center / left / right / up / down / up_left / up_right / down_left / down_right` に配置を保存します。顔の中央と輪郭に奥行き差を持つ共通メッシュで補間し、ロールは補間結果に重ねます。省略時はテンプレートが各キャラのパーツ役割から初期配置を生成します。初期配置は見た目の確認が必要です。

キャプチャモーションは親の [ブラウザプレイヤー](PLAYER.md) で、指定したキャラを直接開いて利用します。再生のヨー・ピッチ・ロール倍率は各0〜3倍で、自動首振りの角度設定とは別です。新規9方向の上下変形は約50%から調整し、既存の保存済みメッシュの角度基準は引き継ぎます。

## 制作の権限と完成品のオフライン利用

Codexへはキャラクター画像・確認画像・作業指示を入力として渡します。エージェントの書き込み範囲はキャラ制作フォルダ内で、コマンドのネットワークアクセスと権限拡張は許可しません。制作に必要な既存Python/Nodeツールはその範囲で実行します。エージェントのビルド出力・一時ファイルは `work/agent-output` と `work/agent-tmp` に置き、親の処理が検証後に完成品を `dist` へ書き出します。

リモートapp-serverは `wss://` のみ利用できます。平文の `ws://` は `localhost`・`127.0.0.1`・`[::1]` に限ります。URLへ認証情報を埋め込まず、必要なトークンは環境変数で渡します。

完成品の再生・調整・WebM保存にはインターネット接続は不要です。ローカル追従もSDKとモデルを準備済みならオフラインで動作します。初回セットアップとCodexによる制作は接続が必要です。
