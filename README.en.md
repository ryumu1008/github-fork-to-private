# GitHub Fork to Private

[简体中文](README.md) | **English**

A Chrome extension that copies a GitHub repository into a separate private repository. It supports GitHub's web-based importer and can generate a script for copying a repository from your local terminal.

Current version: **1.0.1**. Requires Chrome / Chromium 106 or later.

This guide is available in Chinese and English. The extension's interface is currently in Chinese; this guide explains the relevant button labels.

**[Download the Chrome extension (1.0.1 ZIP)](https://github.com/ryumu1008/github-fork-to-private/releases/download/v1.0.1/github-fork-to-private-1.0.1.zip)** · [View releases](https://github.com/ryumu1008/github-fork-to-private/releases/latest)

## Installation and updates

### Install from the ZIP (recommended)

1. Download the ZIP using the link above and **extract it to a folder you will keep**. The package includes a Chinese quick-start guide named `安装说明.txt`.
2. Enter `chrome://extensions` in Chrome's address bar and enable **Developer mode** in the upper-right corner.
3. Click **Load unpacked** and select the extracted folder **containing `manifest.json`**.
4. Confirm that the extension shows version **1.0.1**, then refresh any open GitHub pages. You can pin the extension from Chrome's puzzle-piece toolbar menu.

Installation does not require Git, Node.js, npm, or a build step. To install manually in Chrome, extract the ZIP and load its folder; double-clicking the ZIP does not install the extension. See [Chrome's official instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked). Keep the extracted folder in place after installation. Moving or deleting it may prevent the extension from working.

### Update an existing installation

Download and extract the new version, then update the files in the folder you originally loaded. Go to `chrome://extensions`, click **Reload** on the extension's card, check the version, and refresh GitHub pages. If you have edited the source yourself, back up your changes before updating. Manually installed extensions do not update automatically.

### Install from source (for developers)

```sh
git clone https://github.com/ryumu1008/github-fork-to-private.git
```

Follow the Chrome loading steps above and select the project folder. After updating the source with Git, reload the extension and refresh GitHub pages.

## Usage

### Import through GitHub

On a GitHub repository page, click **复制到私有** (Copy to private). You can also open the extension from the toolbar and enter the source repository and target name.

The extension opens GitHub's official import page, fills in the URL and name, selects **Private**, and checks the complete form, source URL, name, and visibility before submitting. By default, it submits after a three-second countdown. You can cancel the countdown or turn off automatic submission in settings. Check the account or organization selected as the owner on the import page.

- Only tasks started by this extension and bound to the current tab and page are accepted. A link constructed outside the extension cannot directly trigger an automatic import.
- If the complete form cannot be found, the inputs change, or Private visibility cannot be confirmed, the extension stops without submitting.
- Tasks are stored separately, so opening multiple import pages does not overwrite other tasks.
- The history status **已发起提交，结果待确认** (Submission requested; result not yet confirmed) only means that submission was requested. **Check GitHub's result page to confirm whether the import succeeded.**
- Importing depends on GitHub's current page structure and service availability. GitHub may require additional authentication for private source repositories; the extension does not read or fill in credentials.

### Copy from a local terminal

Install Git and GitHub CLI, then sign in with `gh auth login --hostname github.com`. Click **复制本地终端命令** (Copy local terminal command), review the generated script, and paste it into Bash or Zsh. The script runs in a separate Bash process.

- It uses **the account currently signed in to gh**, which may differ from the account signed in to your browser.
- It expands the default `~/Projects` path and creates a subfolder named after the target repository.
- It stops if the local target folder already exists, repository creation fails, the target is not private, the remote is not empty, or another operation fails. It does not overwrite existing local files or attempt to delete existing remote repositories.
- It copies all Git branches and tags and preserves the source's default branch. The `origin` remote points to the new private repository; `upstream` points to the source, with pushing disabled.
- If Git LFS is installed, the script attempts to migrate all LFS objects. Otherwise, it explicitly reports that only Git branches and tags are being copied and that LFS objects require separate migration.
- A failed operation may leave an empty private repository or a partial local copy. Review and handle these yourself; the script does not delete them automatically.

## What is copied and what is not

This is a tool for copying Git repositories, **not a complete project backup tool**.

- GitHub Importer does not migrate LFS objects, Issues, or Pull Requests. See [GitHub Importer's official limitations](https://docs.github.com/en/migrations/importing-source-code/using-github-importer/about-github-importer).
- Copying Git branches and tags does not include platform data such as release assets, Issues, Pull Requests, project settings, or Actions secrets.
- External repositories referenced by submodules do not automatically become private copies. You must handle their URLs separately.
- A private repository is not a substitute for secret management. Do not commit real secrets to Git history.

## Data and permissions

The extension has no telemetry or developer-operated backend. It does not upload usage history to the developer or read cookies, passwords, or tokens. Operations use GitHub's own pages or local Git/gh commands that you choose to run.

- `storage`: stores local settings and the 30 most recent history entries, including the source URL, target name, time, and status. You can clear them in **历史记录** (History).
- Temporary import tasks are stored for the browser session and expire when you restart the browser or reload the extension. Authorization identifiers are not saved in history.
- `activeTab`: reads the current tab's URL when you open the extension popup.
- `https://github.com/*`: displays the repository button and helps fill in GitHub's import form.
- The extension does not request the broader `tabs` permission to read all tab URLs.

## Development, checks, and packaging

Requires Node.js 22.13 or later, Python 3, Git, and both Bash and Zsh for the CLI tests.

```sh
npm ci --ignore-scripts
npm test
npm run package
```

The JavaScript runtime files have no third-party dependencies. jsdom is used only for development tests and is not included in the extension ZIP. Packaging writes `dist/github-fork-to-private-1.0.1.zip` using an explicit file list that excludes `.git`, tests, development dependencies, and local personal files.

Regression tests cover serialized task claiming, tab/page identity checks, concurrent tasks, form validation, native submit buttons, unsafe input, history rendering, and Bash/Zsh scripts. Branch and tag tests use real temporary local Git repositories and isolated GitHub command substitutes; they do not create real GitHub repositories. Actual signed-in behavior, changes to GitHub's pages, and cloud import results still need to be confirmed in real use.

## License and feedback

[MIT License](LICENSE). For security issues, see [SECURITY.md](SECURITY.md) (in Chinese). Changes and verification records are documented in the [change log](https://github.com/ryumu1008/github-fork-to-private/blob/main/修改记录.md) (in Chinese).
