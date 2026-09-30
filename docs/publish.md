# GitHub Pages手動公開

1. `main` にソースをプッシュする。
2. GitHubのリポジトリで **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする。
3. **Actions → Publish NAIL TRACKING LAB → Run workflow** を手動実行する。
4. `github-pages` のデプロイが成功したら、表示されたHTTPS URLをiPhoneのChromeで開く。

このワークフローは `workflow_dispatch` のみで起動する。プッシュ時や定刻の自動実行は設定していない。
