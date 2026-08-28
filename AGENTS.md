# Agent 协作入口

接手本仓库任务时，先阅读 [开发协作 SOP](docs/development-sop.md)、[协作与版本发布规范](CONTRIBUTING.md) 和 [README](README.md)。

必须遵守：

- 从最新 `main` 创建单任务短期分支，不直接修改或推送 `main`；
- 使用 Conventional Commits，并在提交前运行测试和构建；
- 通过 PR、评审和 CI 后才可合并；默认使用 Squash merge；
- 保留并说明用户已有的未提交改动，不使用破坏性 Git 命令；
- 不自行合并 PR、修改 GitHub 保护规则、删除他人分支或处理未授权告警；
- 结束工作时提供改动、验证、提交、PR 和剩余风险的交接信息。

具体命令和异常处理以 `docs/development-sop.md` 为准。
