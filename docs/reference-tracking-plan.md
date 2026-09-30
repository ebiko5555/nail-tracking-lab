# 参考デモから抽出した機能と追跡改善計画（2026-10-01）

対象：[Perfect Corp. の AR バーチャルネイル](https://www.perfectcorp.com/ja/business/showcase/nail-color)。これは公開ページに記された機能を分析した資料であり、Perfect Corp. の独自実装やコードを利用する計画ではない。現行アプリの機能と、公開資料から確認できる参考機能を区別する。

## 何を再現すべきか

| 機能 | 参考ページで確認できる内容 | 本アプリの現状 | 優先度と次の作業 |
|---|---|---|---|
| 手と爪への密着 | [AgileHand の説明](https://www.perfectcorp.com/ja/business/technologies/agile-hand-tracking/)は手の動き、手・指のサイズへの追従をうたう | MediaPipeの21点から爪の中心・幅・長さを推定。爪の画素境界は未検出 | 最優先。手の追跡と爪の輪郭認識を別モデルにし、誤差を実測する |
| 指の傾きと動き | 手を動かしてもライブ映像に重なる | One Euro Filterと短時間保持。2026-10-01に描画角度も平滑化後の値へ修正 | 静止時の揺れ、移動時の遅延、喪失後の復帰を別々に測る |
| 自動サイズ合わせ | [AgileHand の説明](https://www.perfectcorp.com/ja/business/technologies/agile-hand-tracking/)は物理的な校正具なしで手・指サイズを推定すると述べる | 関節距離で概算し、5指別の手動補正が必要 | 爪輪郭モデルの精度確認後、補正を初期値ではなく例外的な操作にする |
| 単色・5本別色 | [デモページ](https://www.perfectcorp.com/ja/business/showcase/nail-color)のシングルカラー／マルチカラー | 実装済み | 追跡精度の評価には、各指別色が取り違えの発見に役立つ |
| 仕上がり | クリーム、ジェル、シアー、マット、メタリック、パール、テクスチャー、シマー | 最初の4種を簡易描画 | 輪郭精度の後に追加。照明や反射の再現を実測なしに「リアル」と呼ばない |
| ネイルデザイン・プレスオン | デモにカテゴリーあり | 未実装 | 色の密着が確認できてから、画像素材の変形・透視・はみ出し抑制を検証 |
| 環境照明への適応 | [AgileHand の説明](https://www.perfectcorp.com/ja/business/technologies/agile-hand-tracking/)は周辺光を反映した描画を説明 | 固定色と簡易グラデーションのみ | 爪領域の色・明るさを端末内で解析し、反射表現を調整する。輪郭認識より後 |
| 見比べ・保存 | [導入事例](https://www.perfectcorp.com/business/successstory/perfect-virtual-try-on-boosts-sally-hansen-sales)は色の比較とルック保存を挙げる | 元画像との切替、明示的な写真保存 | 試着体験として維持。写真は自動保存・外部送信しない |

## 技術的な差

現状の MediaPipe Hand Landmarker は21個の骨格点と奥行き情報を返す。[公式仕様](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js)に爪の境界出力はない。骨格点だけでは、実際の爪幅、甘皮、先端の曲線、指が重なるときの可視領域を決められない。描画だけを磨いても、参考デモに近い「密着感」には到達しない。

端末内で動く爪専用の輪郭モデルを、手追跡とは独立に追加するのが中心課題。手追跡で5本の爪候補周辺を切り出し、輪郭モデルが各領域のマスクを返す。ランドマークは指の識別と大きな移動を支え、輪郭マスクは色を塗る境界を決める。輪郭モデルが不確かなときはマスクを信用せず、推定表示であることを示すか、色を消す。見失った爪を検出中と表示しない。

公開研究の[モバイル端末内リアルタイム爪セグメンテーション論文](https://arxiv.org/abs/1906.02222)は、この分離が有効な方向であることを示す。ただし論文の29.8 msと94.5% mIoUは著者のiPad Pro・データでの値であり、このアプリやiPhoneでの実測ではない。再利用可能な学習済み重みも同ページから確認できていない。

## 学習済みモデルの採否

- [mnemic/nails_seg_yolov8](https://huggingface.co/mnemic/nails_seg_yolov8)：モデルカードと[学習元データ](https://universe.roboflow.com/personal-projects-jfbag/nails_segmentation)はCC BY 4.0と表示される。一方、公開重みはPyTorchの `.pt` で、モデルページはpickleを危険な形式として表示している。[Ultralytics の公式説明](https://docs.ultralytics.com/models/yolov8)にはYOLOv8自体のAGPL-3.0／Enterprise条件がある。重みの利用条件と変換方法をさらに確認する必要があり、現段階ではアプリに組み込まない。
- [nngeek195/nail-segmentation-v1](https://huggingface.co/nngeek195/nail-segmentation-v1)：MIT表示だが、掲載の利用方法は静止画アップロードとPythonサーバー。iPhoneブラウザでのリアルタイム速度と輪郭精度は不明。現段階では組み込まない。
- [austingg/finger-nail-seg](https://github.com/austingg/finger-nail-seg)：ONNXの爪マスクはあるが、リポジトリはGPL-3.0。公開ベンチマークはデスクトップCPUで約290 ms／画像で、iPhoneでのリアルタイム利用を裏付けない。現段階では組み込まない。
- [HemoLens](https://github.com/yelabb/hemolens)：端末内ONNX実行の構成は参考になるが、爪の**矩形検出**が目的で、ネイルカラー用の精密な境界マスクは出さない。輪郭モデルの代わりにはならない。
- [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)：将来の端末内推論候補。公式対応表ではiOS Chrome/SafariのWebAssemblyとWebGLは対応、WebGPUは非対応。モデルとライセンスが決まるまで依存関係には追加しない。

## 次の検証手順

1. iPhone実機で手を静止、上下左右移動、近接・離反、傾け、指を曲げ、近接・重なりの各条件を撮る。照明と距離、機種・iOS・ブラウザを記録する。本人が保存を選ぶまで画像を永続保存しない。
2. 固定フレームで5本の実際の爪輪郭を手動指定する。今回追加した**輪郭重なり率（IoU）**、中心差、面積比を各指・各条件で記録する。IoUは推定輪郭と手動輪郭の重なりであり、実際の爪を自動認識した精度ではない。
3. 静止時は中心座標の揺れ、移動時は映像に対する遅れ、見失い時は誤った位置への飛び移りと復帰時間を測る。FPS、手推論時間、爪推論時間、描画時間は別に記録する。
4. ライセンスを確認できる爪データとモデルを選ぶ。必要なら、許可を得た手の画像を端末・ローカル環境だけで注釈・学習する。肌色、爪の長さ・形、照明、背景、手の向きに偏りがないか確認する。
5. 候補モデルを独立モジュールとして実装し、iPhoneで輪郭IoUと処理時間を現行の骨格推定と同じ画像で比較する。速度のために輪郭が悪化するなら採用しない。

現時点で Perfect Corp. と同等の追跡精度は確認できていない。達成の判断には、共通の画像条件での輪郭・時間方向の実測が必要。
