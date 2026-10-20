# 发布指南：助手也有版本，套娃暂不开工

当前首发版本：**1.0.0**。唯一版本来源是包清单的 `version`，Host 状态和页面版本从这里读取，不用四处同步数字。

本仓库的 CI 只测试和检查打包，**不会自动发布 npm，也不需要配置 npm 令牌**。

## 1. 首次上传 GitHub

在 GitHub 新建一个空仓库，不要让网站自动添加 README 或许可证。然后在项目根目录执行（替换下面的占位地址）：

```sh
git init
git add .
git diff --cached --stat
git diff --cached
# 检查暂存内容，确认没有凭据、日志或个人配置后再提交。
git commit -m "feat: 市场更新市场，所以助手来代班"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/dshmarket-update-helper.git
git push -u origin main
```

如果目录已经是 Git 仓库或配置过 origin，请沿用现有配置，不要重复初始化或覆盖 remote。这里只提供操作说明，上传由你确认后执行。

拿到真实仓库地址后，在包清单补上这些字段（替换 YOUR_NAME，不要原样发布）：

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/YOUR_NAME/dshmarket-update-helper.git"
  },
  "homepage": "https://github.com/YOUR_NAME/dshmarket-update-helper#readme",
  "bugs": {
    "url": "https://github.com/YOUR_NAME/dshmarket-update-helper/issues"
  }
}
```

## 2. 发布前检查

```sh
npm run check
npm test
npm pack --dry-run
```

- 确认 MIT 许可证符合你的意愿，版权声明需要的话可改成自己的名字。
- 确认包名可用且你有发布权限；不要为了名字被占用就覆盖别人的包。
- 包清单已移除 `private: true`，并限制了分发文件；仍请人工看一遍打包清单。
- npm 包含运行时文件、图标、语言资源、README、LICENSE 和更新日志；GitHub 模板、测试和本地开发文件不进包。
- GitHub CI 成功仅代表静态检查和模拟测试通过，不代替真实 DSH 环境与 UI 验证。

`prepack` 会再执行检查和测试；**没有自动发布脚本**。

## 3. 首次发布 npm

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish --access public --registry=https://registry.npmjs.org/
```

按 npm 提示完成双因素验证。不要把令牌写进源码或提交到 GitHub；个人 `.npmrc` 已被忽略。

发布成功后为这个版本打 Git 标签：

```sh
git tag v1.0.0
git push origin v1.0.0
```

在 GitHub 的 Releases 页面选择这个标签创建 Release，说明可以使用更新日志对应段落。发布 npm 和 GitHub Release 是两件事，上传源码不会自动让 npm 多一个包。

## 4. 以后更新

先改代码、测试和 Unreleased 更新日志，再按变化选择版本：

```sh
# 三选一。未发布的首发 1.0.0 不必额外升版。
npm version patch --no-git-tag-version
# npm version minor --no-git-tag-version
# npm version major --no-git-tag-version
```

把 Unreleased 内容归档为新版本，执行检查与打包预览，提交后手动发布，再打与包版本一致的 `vX.Y.Z` 标签。

- PATCH：修 bug。
- MINOR：新增向后兼容功能。
- MAJOR：不兼容改动。

npm 上同一个版本不能覆盖发布。发错了就发下一个版本，不要和时间线硬刚。

## 5. 本机已经安装了这个助手？

源码改变不代表运行中的 Host 和浏览器模块已换成新版本。按 DSH 的插件更新流程处理，并根据结果重启 / 刷新；仅凭原入口还在，不能证明新代码已经加载。
