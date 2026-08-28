# 协作与版本发布规范

本项目采用 GitHub Flow。`main` 始终保持可部署、稳定；所有改动都必须通过短期分支和 Pull Request（PR）进入 `main`，不得直接推送。

完整的逐步操作、接手检查和 agent 交接格式请参阅[开发协作 SOP](docs/development-sop.md)。本文保留规则总览和发布约束。

## 日常开发

开始工作前，从更新后的 `main` 创建语义明确的短期分支：

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/example
```

分支使用以下前缀：

- `feature/`：新功能
- `fix/`：缺陷修复
- `docs/`：文档改动
- `chore/`：工具、构建或维护工作

在分支上小步提交并及时推送，方便协作者了解进度。提交信息遵循 Conventional Commits：

```text
<type>(scope): <subject>
```

常用 `type` 为 `feat`、`fix`、`docs`、`refactor`、`test` 和 `chore`。例如：

```text
feat(casino): 支持重排盖牌
fix(table): 恢复千术后的翻牌操作
docs(repo): 补充发布流程
```

首次安装依赖后，`npm run prepare` 会启用 Husky。每次提交都会由 commitlint 校验格式；CI 也会在 PR 中校验全部新增提交。

当 `main` 有新提交时，先同步远程再将当前分支变基到 `origin/main`：

```bash
git fetch origin
git rebase origin/main
```

解决冲突并验证后再推送。若变基改写了已推送分支历史，使用受保护的强推：

```bash
git push --force-with-lease
```

不要使用普通 `--force`。

## Pull Request 与合并

开发完成后创建指向 `main` 的 PR，按模板说明改动、验证、风险和回滚方式。PR 必须满足：

- 至少一位协作者批准评审；
- CI 的 `test-and-build` 检查通过；
- 所有讨论已解决。

使用 Squash and merge 合并，合并提交保持 Conventional Commits 格式。合并后立即部署，并删除远程短期分支。仓库应启用 GitHub 的自动删除 head branch 选项。

## 版本发布

版本号遵循语义化版本（SemVer）：`MAJOR.MINOR.PATCH`，例如 `v2.1.3`。

- `MAJOR`：不兼容的 API 或行为改动；
- `MINOR`：向后兼容的新功能；
- `PATCH`：向后兼容的缺陷修复。

发布时从最新 `main` 创建短期 `release/vX.Y.Z` 分支，更新版本号、变更记录和发布说明，通过 PR 审核与 CI 后 squash 合并到 `main`，随后打上同名 Git tag 并部署。发布分支合并后应删除，不保留长期 `release` 或 `develop` 分支。

## 仓库管理员设置

管理员需要在 GitHub 的 `Settings -> Branches`（或 Rulesets）为 `main` 配置：要求 PR、至少 1 个批准评审、提交后撤销过期批准、解决全部对话、通过 `CI / test-and-build` 状态检查；同时禁止直接推送和强制推送。该保护规则由 GitHub 托管，不能由仓库内文件替代。
