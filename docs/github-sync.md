# GitHub 项目同步

仓库：[a805930382123-yper/AIPM-Workspace](https://github.com/a805930382123-yper/AIPM-Workspace)。当前仓库为公开仓库。

用户于 2026-10-22 授权上传现有项目，并在后续每次任务修改完成、必要检查结束后提交并同步。此操作只备份项目版本，不改变 KB02 未通过的验收结论，也不启动下一批开发。

## 已配置的同步方式

`origin` 指向 `https://github.com/a805930382123-yper/AIPM-Workspace.git`，主分支为 `main`。本机 `core.hooksPath` 指向 `.githooks`。每次 `git commit` 成功后，`post-commit` 钩子自动推送当前分支，并设置对应的远程跟踪分支。推送使用当前机器的 Git 登录凭证，项目中不存放登录令牌。

文件保存本身不创建提交。Codex 按 `AGENTS.md` 在任务完成后统一检查、提交、同步；手工修改完成后也通过正常的 `git add`、`git commit` 触发。这样远程保存的是可说明的任务版本。

## 新克隆或其他电脑

Git 不会自动启用克隆仓库内的钩子。在新克隆的项目目录执行：

```powershell
git config --local core.hooksPath .githooks
git config --local push.default simple
```

如 Git 提示目录所有权不同，只信任你确认属于此项目的绝对路径：

```powershell
git config --global --add safe.directory 'E:/AI/Work/AIPM Workspace'
```

使用本机 Git 凭证管理器登录有仓库写权限的账号，再按正常流程提交。Linux/macOS 如钩子缺少执行权限，先执行 `chmod +x .githooks/post-commit`。

## 失败与核对

推送失败会输出错误，本地提交仍保留。解决网络、认证或远程冲突后执行 `git push`；不使用强制推送覆盖远程。`git status -sb` 显示本地领先时表示尚有提交未同步。

本次首次上传直连 GitHub 曾连接重置，随后使用 Windows 已启用的本机代理成功上传。该连接配置仅保存在本机 `.git/config`；代理端口变化后，应更新本地 `http.https://github.com/.proxy`，或在可以直连时用 `git config --local --unset http.https://github.com/.proxy` 移除。其他电脑使用各自可用的网络设置。

```powershell
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

两个提交 SHA 一致才表示 `main` 已同步。其他分支将命令中的 `main` 换成当前分支名。

`.gitignore` 排除 `.env.local` 等真实配置、`workspace/` 本地资料、`node_modules/`、`dist/`、`.test-*/`、`.rn-*/` 和 `.scratch-*/`。保留 `.env.example`、源码、任务卡、测试与既有验收证据。原有历史提交保留。
