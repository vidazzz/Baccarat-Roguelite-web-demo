# 开发协作 SOP

本文是项目成员和 coding agent 接手任务时的标准操作流程。除非项目负责人明确授权，不得绕过其中的分支、评审和验证要求。

## 0. 先确认项目状态

在项目目录执行：

```bash
git status --short --branch
git branch -vv
git fetch origin
```

确认以下事项：

- 当前任务、目标分支和相关 PR 没有被其他人重复处理；
- 工作区中已有的改动属于自己，或已记录并得到负责人确认；
- 不在 `main` 上直接开发；
- 不使用 `git reset --hard`、`git clean -fd` 或普通 `git push --force` 清理/覆盖他人工作。

如果发现未理解的本地改动，先停止修改，记录文件和提交状态并询问负责人。

## 1. 接手新任务

先阅读：

1. `README.md`：项目范围、运行方式和当前已知限制；
2. `CONTRIBUTING.md`：分支、提交、PR 和发布规则；
3. 本文：具体执行步骤；
4. `docs/game-design.md` 与 `docs/technical-design.md`：涉及玩法或技术架构时阅读相关章节。

明确任务的验收条件、影响范围、是否需要文档或测试。简单改动不要求截图测试；涉及视觉或复杂交互时，再按任务风险决定是否进行浏览器验证。

## 2. 创建短期分支

从最新远程 `main` 创建有意义的短期分支：

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/short-description
```

分支前缀约定：

- `feature/`：新功能
- `fix/`：缺陷修复
- `docs/`：文档
- `test/`：测试补充
- `chore/`：构建、依赖和维护

分支只服务一个目标，不创建长期 `develop`、个人永久分支或与任务无关的混合分支。

## 3. 开发与提交

先定位现有实现和测试，再进行最小范围修改。保持提交小而独立，完成一个可解释的步骤就提交并推送一次。

提交信息必须符合 Conventional Commits：

```text
<type>(scope): <subject>
```

例如：

```bash
git add src/game.ts src/game.test.ts
git commit -m "fix(gameplay): 恢复千术后的翻牌操作"
git push -u origin fix/restore-card-flip
```

Husky 会在本地提交时运行 commitlint；CI 会在 PR 中再次检查全部新增提交。不要提交密钥、构建产物、日志或本地配置文件。

## 4. 验证改动

提交 PR 前至少运行：

```bash
npm ci
npm test -- --run
npm run build
git diff --check
```

根据改动补充针对性检查。验证失败时不要创建“先合并再修”的 PR；修复后重新运行完整检查，并在 PR 中写明实际执行过的命令。

## 5. 创建和维护 PR

```bash
gh pr create --base main --head <branch> \
  --title "feat(scope): 简短描述" \
  --body-file .github/PULL_REQUEST_TEMPLATE.md
```

PR 必须说明：改了什么、如何验证、风险是什么、如何回滚。保持 PR 与单一任务一致，及时推送后续提交并回复评审意见。

当 `main` 有新提交时：

```bash
git fetch origin
git rebase origin/main
npm test -- --run
npm run build
git push --force-with-lease
```

只有变基改写了自己分支的远程历史时才使用 `--force-with-lease`，禁止普通 `--force`。

## 6. 评审与合并

PR 必须满足以下条件后才能合并：

- 至少一位协作者批准；
- `CI / test-and-build` 通过；
- 所有讨论已解决；
- 分支已基于最新 `main`，且没有冲突。

使用 **Squash and merge**，合并提交保持 Conventional Commits 格式。不要直接推送 `main`，不要在 CI 未通过时强行合并。

## 7. 合并后清理与接续工作

合并后同步本地 `main` 并删除本地短分支：

```bash
git switch main
git pull --ff-only origin main
git branch -d <branch>
```

远程短分支由 GitHub 的自动删除设置清理；如果未启用，则手动执行：

```bash
git push origin --delete <branch>
```

下一项任务必须从最新 `main` 重新创建分支，不在已合并分支上继续开发。

## 8. Agent 接手/交接格式

Agent 开始工作前应报告：当前分支、工作区状态、任务目标、计划修改文件和验证方式。结束时应报告：完成的改动、测试结果、提交 hash、远程分支/PR 地址、未处理风险和需要人工决定的事项。

交接信息至少包含：

```text
任务：
分支：
基线：
改动：
验证：
提交：
PR：
剩余决定：
```

Agent 不得自行合并 PR、修改分支保护、删除他人分支或处理未授权的安全告警；这些动作必须得到负责人明确授权。

## 9. 发布

发布遵循 SemVer：`MAJOR.MINOR.PATCH`。从最新 `main` 创建短期 `release/vX.Y.Z` 分支，更新版本号和发布说明，走同样的 PR、评审和 CI 流程；合并后创建对应 Git tag 并部署。发布分支随后删除。
