# GitHub 一键复制到私有 (Fork to Private)

<p align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="GitHub Fork to Private Icon" />
</p>

<p align="center">
  <strong>一键将 GitHub 上的公开项目或已 Fork 仓库复制为完全独立的私有仓库，保留完整 Commit 历史与分支。</strong><br>
  <em>One-click tool to duplicate any public or forked GitHub repository into a standalone private repository.</em>
</p>

---

## 🌟 为什么需要这个插件？ / Why this extension?

在 GitHub 上：
* **公开 Fork 无法转为私有**：当你在 GitHub 上 Fork 一个公开项目后，官方限制该 Fork 必须保持公开，无法直接切换为私有。
* **隐私与定制需求**：在二次开发、做私有笔记、测试配置或嵌入个人凭据时，公开 Fork 极易造成信息泄露。

**GitHub Fork to Private** 通过 GitHub 官方原生的云端导入机制，无需在本地下载上传数以百兆的 Git 历史，一键在 GitHub 云端完成完整镜像，自动建立属于你的独立私有仓库！

---

## ✨ 核心特性 / Features

1. **GitHub 页面无缝注入**：在任何仓库主页的 Star / Fork 按钮旁自动注入 **「🔒 复制到私有」** 按钮。
2. **免 Token 极速云端克隆**：
   - 无需创建或配置 GitHub Personal Access Token (PAT)，直接复用浏览器已有登录会话。
   - 自动填入源地址、目标仓库名（默认带 `-private` 后缀）。
   - **强制私有校验**：提交前强制双重核验【Private】单选框处于已勾选状态，严防因页面结构或网络异常误建公开库。
   - 3 秒倒计时自动启动导入，期间支持随时取消或手动检查。
3. **防御钓鱼与仿冒触发 (Anti-CSRF Nonce)**：
   - 杜绝通过恶意链接（如特制 Hash 链接）诱导用户自动克隆；只有用户在插件弹窗或页面按钮亲自触发生成的单次随机 Nonce，才被允许执行。
4. **安全可靠的本地双 Remote 终端命令**：
   - 自动包含 `set -euo pipefail` 严格容错，任何一步执行失败立即中断，绝不盲目继续；
   - 代码推送前自动调用 `gh repo view` 二次校验远端库必须为【私有】，杜绝推送到已存在的同名公开库。
5. **绝对安全与隐私 (Zero Tracking)**：
   - 纯前端本地运行，不收集任何用户数据，不向任何第三方服务器发送请求。

---

## 🚀 安装指南 / Installation

1. 下载或克隆本仓库到本地：
   ```bash
   git clone https://github.com/<your-username>/github-fork-to-private.git
   ```
2. 打开 Chrome 浏览器，在地址栏访问：
   ```text
   chrome://extensions
   ```
3. 打开右上角的 **「开发者模式 (Developer mode)」**。
4. 点击左上角的 **「加载已解压的扩展程序 (Load unpacked)」**。
5. 选中本项目文件夹即可完成安装。
6. （推荐）在 Chrome 工具栏右上角的拼图图标中，将 **Fork to Private** 固定在工具栏。

---

## 📖 使用方法 / Usage

### 方式 1：在 GitHub 网页上直接点击（最快捷）
1. 打开任意你想转为私有的 GitHub 仓库主页。
2. 点击右上角的 **「🔒 复制到私有」** 按钮。
3. 在弹出的面板中确认仓库名称（如 `project-private`），点击 **「立即一键复制到私有仓库」**。
4. 页面将自动跳转至云端导入页并在 3 秒内启动克隆，完成后自动进入你的新私有仓库。

### 方式 2：通过浏览器右上角插件图标
1. 点击浏览器工具栏的插件图标。
2. 若当前在 GitHub 页面，将自动读取仓库信息；若在其他页面，可手动粘贴 GitHub URL。
3. 可选择直接云端导入，或点击「复制本地终端命令」在本地执行双 Remote 克隆。

---

## 📄 开源许可 / License

本项目基于 [MIT License](LICENSE) 开源协议。
