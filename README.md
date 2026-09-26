# GitHub 一键复制到私有（Fork to Private）

**简体中文** | [English](README.en.md)

Chrome 扩展：将 GitHub 仓库复制到独立的私有仓库。支持 GitHub 云端导入，以及生成本地复制脚本。

当前版本：**1.0.2**。需要 Chrome / Chromium 106 或更新版本。

本说明提供中文和英文版本；扩展界面目前为中文。

**[下载 Chrome 扩展安装包（1.0.2 ZIP）](https://github.com/ryumu1008/github-fork-to-private/releases/download/v1.0.2/github-fork-to-private-1.0.2.zip)** · [查看发布版本](https://github.com/ryumu1008/github-fork-to-private/releases/latest)

## 安装与更新

### 下载 ZIP 安装（推荐）

1. 点击上方下载链接，将 ZIP **解压到一个长期保留的文件夹**。包内附有 `安装说明.txt`。
2. 在 Chrome 地址栏输入 `chrome://extensions` 并打开，开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择解压后**包含 `manifest.json` 的文件夹**。
4. 确认扩展版本为 **1.0.2**，刷新已打开的 GitHub 页面即可使用。可在工具栏的拼图按钮里固定本扩展。

安装不需要 Git、Node.js、npm 或构建步骤。Chrome 手动安装需要先解压再加载目录，不能通过双击 ZIP 自动安装；步骤参考 [Chrome 官方说明](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)。安装后不要删除或移动这个文件夹，否则扩展可能无法继续使用。

### 更新已有安装

下载新版本并解压，将文件更新到原先加载的扩展目录，再到 `chrome://extensions` 点击该扩展卡片上的「重新加载」，核对版本并刷新 GitHub 页面。开发者自行修改过文件时，请先备份再更新。手动安装不会自动更新。

### 从源码安装（开发者）

```sh
git clone https://github.com/ryumu1008/github-fork-to-private.git
```

按上面的 Chrome 加载步骤选择项目目录即可。Git 更新源码后，也需要重新加载扩展并刷新 GitHub 页面。

## 使用

### 云端导入

在 GitHub 仓库页面点击「复制到私有」，或打开工具栏上的扩展，填写源仓库和目标名称。

扩展会打开 GitHub 官方导入页，填入地址和名称，选择 Private，并在提交前检查完整表单、源地址、名称和私有状态。默认三秒后提交，可取消倒计时，也可在设置中关闭自动提交。请核对导入页上选择的所属账号或组织。

1.0.2 已适配 GitHub 新版导入页，并额外核对 GitHub 页面显示的私有状态；旧版无法识别新版表单时会停止，请更新后重试。

- 只接受由本扩展发起、与当前标签页和页面身份一致的任务。外部构造的链接不能直接发起自动导入。
- 找不到完整表单、输入发生变化或无法确认 Private 时停止，不盲目提交。
- 每个任务分别保存，同时打开多个导入页不会覆盖彼此。
- 历史中的「已发起提交，结果待确认」只说明已请求提交。**是否导入成功，请以 GitHub 页面的结果为准。**
- 云端导入依赖 GitHub 当前页面结构和服务状态。源库为私有库时，GitHub 可能要求额外认证；扩展不会读取或填写凭据。

### 本地终端复制

准备 Git 与 GitHub CLI，并使用 `gh auth login --hostname github.com` 登录。点击「复制本地终端命令」，核对后粘贴到 Bash 或 Zsh 中执行。脚本在独立 Bash 子进程内运行。

- 使用 **gh 当前登录的账号**，该账号可能与浏览器登录账号不同。
- 自动展开默认 `~/Projects` 目录，在其下创建以目标仓库名命名的子目录。
- 目标本地目录已存在、创建仓库失败、目标不是私有、远端非空或中途出错时停止。原文件不会被覆盖，也不会尝试删除已有远端仓库。
- 复制全部 Git 分支和标签，保留源默认分支；origin 指向新私有仓库，upstream 保留源仓库且禁用推送。
- 若安装了 Git LFS，脚本会尝试迁移全部 LFS 对象；未安装时明确提示只复制 Git 分支和标签，LFS 文件需另行迁移。
- 中途失败可能留下已经创建的空私有仓库或部分本地副本。请核对后自行处理，脚本不会自动删除它们。

## 复制范围与限制

这是 Git 代码复制工具，**不是完整项目备份工具**。

- GitHub Importer 不迁移 LFS 对象、Issues 和 Pull Requests；请参考 [GitHub Importer 官方限制](https://docs.github.com/en/migrations/importing-source-code/using-github-importer/about-github-importer)。
- Git 分支/标签复制不包括 Releases 的附件、Issues、PR、项目设置、Actions Secrets 等平台数据。
- 子模块中的外部仓库不会自动变成私有副本，其地址仍需自行处理。
- 私有仓库不能替代密钥管理。不要把真实密钥提交到 Git 历史中。

## 数据与权限

扩展没有遥测或自建后端，不向开发者上传使用记录，不读取 cookie、密码或 Token。操作通过 GitHub 自己的页面和用户主动执行的本地 Git/gh 命令完成。

- `storage`：保存本机设置和最近 30 条历史（源地址、目标名、时间、状态）。可在「历史记录」清空。
- 临时导入任务保存在浏览器会话内，重启浏览器或重新加载扩展后失效；授权标识不保存到历史记录。
- `activeTab`：用户打开弹窗时读取当前标签页地址。
- `https://github.com/*`：显示仓库按钮并辅助填写 GitHub 导入表单。
- 不申请读取所有标签页地址的 `tabs` 权限。

## 开发、检查与打包

需要 Node.js 22.13 或更新版本、Python 3、Git，以及运行 CLI 测试所需的 Bash 和 Zsh。

```sh
npm ci --ignore-scripts
npm test
npm run package
```

JS 运行文件无第三方依赖；jsdom 仅用于开发测试，不进入扩展 ZIP。打包输出为 `dist/github-fork-to-private-1.0.2.zip`，使用明确的文件清单，不包含 `.git`、测试、开发依赖或本机资料。

65 项回归测试覆盖任务串行领取、标签页/页面身份验证、并发、新旧导入表单、原生按钮、危险输入、历史呈现及 Bash/Zsh 脚本。自动化测试中的 Git 分支/标签检查使用临时本地仓库和隔离的 GitHub 命令替身，不创建真实 GitHub 仓库。

另外，已在真实登录的浏览器中通过插件完成云端导入，并在真实 GitHub 服务上验证本地复制：目标为独立私有仓库，分支、标签、代码对象和默认分支一致，未登录无法访问。详见 [1.0.2 验证结果](https://github.com/ryumu1008/github-fork-to-private/blob/main/docs/verification/1.0.2.json)。这不代表未来 GitHub 页面改版仍兼容；真实 LFS 数据迁移尚未验证，每次导入仍须查看 GitHub 的结果。

## 许可与反馈

[MIT License](LICENSE)。安全问题请参阅 [SECURITY.md](SECURITY.md)。修改与验证记录见 [修改记录.md](https://github.com/ryumu1008/github-fork-to-private/blob/main/修改记录.md)。
