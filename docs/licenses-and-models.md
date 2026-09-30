# 使用物と爪専用モデルの調査（2026-09-30）

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
| [nails_seg_yolov8](https://huggingface.co/mnemic/nails_seg_yolov8) | モデルカードはCC-BY-4.0 | 重みは公開。iPhone Safari上の変換後精度・速度は未計測。学習データと推論実装の権利・移植手順も要確認。今回は不採用 |
| [nail-segmentation-v1](https://huggingface.co/nngeek195/nail-segmentation-v1) | モデルカードはMIT | U-Netの静止画アップロード＋Pythonサーバー構成。端末内のリアルタイム動作は示されていない。今回は不採用 |
| [dongbingfeng/nail-segmentation](https://github.com/dongbingfeng/nail-segmentation) | リポジトリはMIT | READMEでU-Netチェックポイントの別途配置、FastAPIバックエンドを要求。iPhone内完結の条件と合わず不採用 |

いずれも手元のiPhoneで輪郭精度・推論速度を実測できていない。「適切なモデル」と認定せず、爪専用認識は未実装とした。将来モデルを追加する場合は `src/tracking/contour.ts` の契約に従い、ランドマーク推定と独立に出力する。
