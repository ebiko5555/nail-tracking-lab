# 使用物と爪専用モデルの調査（2026-10-01）

| 使用物 | 固定版 | ライセンス | 商用利用の判断 |
|---|---:|---|---|
| [MediaPipe Tasks Vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) | 0.10.35 | Apache-2.0 | ライブラリの商用利用可。著作権表示・ライセンス保持が必要 |
| [Vite](https://github.com/vitejs/vite/blob/main/packages/vite/LICENSE.md) | 7.1.12 | MIT | 可。著作権表示・ライセンス保持が必要 |
| [TypeScript](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt) | 5.9.3 | Apache-2.0 | 可。著作権表示・ライセンス保持が必要 |
| Canvas API | ブラウザ標準 | ライブラリ不要 | ブラウザ実装に依存 |

MediaPipeの[公式サンプル](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md)が指定するHand Landmarkerモデルを、実行時にGoogleの公開URLから取得する。モデル本体はこの納品物に再配布していない。モデルファイル個別の再配布条件・商用利用条件を確認できていないため、将来TSUYAで商用利用する前に権利を再確認する。モデル取得時はGoogleへ通常のHTTPリクエストが出るが、アプリから映像や撮影フレームを送信する処理はない。初回取得後もブラウザのキャッシュ状況により通信が必要になる。WASMは同梱して同一オリジンから配信する。

## 調査した爪輪郭モデル

| 候補 | 出典・ライセンス | 評価と採用判断 |
|---|---|---|
| [nails_seg_yolov8](https://huggingface.co/mnemic/nails_seg_yolov8) | モデルカードと[学習元データ](https://universe.roboflow.com/personal-projects-jfbag/nails_segmentation)はCC BY 4.0表示。一方[Ultralytics YOLOv8公式](https://docs.ultralytics.com/models/yolov8)はAGPL-3.0／Enterprise条件を案内 | 公開重みはpickleを含む `.pt`。iPhone上での変換後精度・速度は未計測。重みと変換・推論実装の権利も要確認。今回は不採用 |
| [nail-segmentation-v1](https://huggingface.co/nngeek195/nail-segmentation-v1) | モデルカードはMIT | 公開された学習スクリプトと実行アプリではU-Netの定義と画像の前処理が異なる。どの重みをどの設定で再現するか検証が必要。Pythonサーバー構成で、iPhone端末内のリアルタイム動作は示されていない。今回は不採用 |
| [dongbingfeng/nail-segmentation](https://github.com/dongbingfeng/nail-segmentation) | リポジトリはMIT | READMEでU-Netチェックポイントの別途配置、FastAPIバックエンドを要求。iPhone内完結の条件と合わず不採用 |
| [austingg/finger-nail-seg](https://github.com/austingg/finger-nail-seg) | リポジトリはGPL-3.0 | ONNX重みを公開するが、デスクトップCPUでの公開値は約290 ms／画像。iPhone実測と重みの由来の確認が必要。今回は不採用 |
| [MakeML-Nails](https://github.com/makeml-app/MakeML-Nails) | リポジトリ内にライセンスファイルを確認できず | TFLite重みを同梱したiOS例だが、再配布・商用利用の権利を確認できず、ブラウザとiPhoneでの精度・速度も不明。今回は不採用 |
| [nail-color-studio](https://github.com/ferrikrisdiantoro/nail-color-studio) | リポジトリ内にライセンスファイルを確認できず | TFLite重みを含む静止画処理例。権利とライブ追跡性能を確認できず、今回は不採用 |

いずれも手元のiPhoneで輪郭精度・推論速度を実測できていない。「適切なモデル」と認定せず、爪専用認識は未実装とした。将来モデルを追加する場合は `src/tracking/contour.ts` の契約に従い、ランドマーク推定と独立に出力する。

公開リポジトリにライセンス表示がない場合、重みを自由に再配布できるとは判断しない。候補の重みをこのアプリへ同梱したり、ユーザーの画像を候補のサーバーに送ったりはしていない。現在の輪郭補正は本人が固定画像を見て指定した形を端末内で使う方式であり、爪専用モデルの代替として実装状態を偽らない。
