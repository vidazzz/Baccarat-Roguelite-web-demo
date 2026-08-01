# Baccarat Roguelite Web Demo

《澳门风云》是一款以百家乐为核心，结合路书判断、风险下注、神助操作和餐厅经营的单机游戏原型。项目目前处于玩法验证阶段，不包含真实货币交易或联机服务。

## 当前内容

- 两座赌场，共十张独立运行的牌桌；
- 标准百家乐点数、自然牌和第三张牌规则；
- 珠盘路、大路、大眼仔路、小路与曱甴路；
- 路书区间标记、路型识别和封盘信心结算；
- 筹码选择、逐枚下注、撤销、确认和旁观流程；
- Three.js 牌桌、发牌运镜、玩家咪牌和荷官开牌；
- 神助触发、点击小游戏、改牌与命中反馈；
- 实时世界时间、餐厅周期收益、升级、典当和 Game Over；
- 技能装配与升级界面，以及 ESC 测试调试菜单。

## 技术栈

- TypeScript
- Vite
- Three.js
- Vitest

## 本地运行

需要 Node.js 20 或更高版本。

```bash
npm ci
npm run dev
```

开发服务器默认监听 `http://127.0.0.1:5173/`。

## 验证

```bash
npm test
npm run build
```

## 自动部署

仓库内置 GitHub Actions 工作流 `.github/workflows/deploy.yml`。推送到 `main` 后，工作流会先执行测试和生产构建，再通过 SSH 将 `dist/` 同步到云服务器。

在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 中配置：

- `DEPLOY_HOST`：服务器域名或 IP；
- `DEPLOY_PORT`：SSH 端口，可选，默认 `22`；
- `DEPLOY_USER`：用于部署的 Linux 用户；
- `DEPLOY_SSH_KEY`：该用户对应的私钥；
- `DEPLOY_PATH`：Nginx 网站根目录，例如 `/var/www/baccarat`。

服务器需要提前创建网站目录、安装 Nginx 和 `rsync`，并把部署公钥加入部署用户的 `~/.ssh/authorized_keys`。工作流只上传构建后的静态文件，不会覆盖服务器上的其他目录。

## 文档

- [MVP 游戏设计文档](docs/game-design.md)
- [MVP 技术设计文档](docs/technical-design.md)

## 项目阶段

当前版本用于验证多桌看路、标记路书、风险下注、沉浸式开牌和场外资金循环。完整肉鸽终点、正式剧情、长期技能平衡、正式存档与移动端适配不在当前版本范围内。
