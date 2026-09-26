(function (root) {
  "use strict";

  const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
  const DEFAULT_SETTINGS = Object.freeze({
    defaultSuffix: "-private",
    defaultLocalDir: "~/Projects",
    autoSubmit: true
  });

  function safeText(value, label) {
    if (typeof value !== "string" || CONTROL_CHARACTERS.test(value)) {
      throw new Error(`${label}必须是文本，且不能包含换行或控制字符`);
    }
    return value.trim();
  }

  function validateRepoName(value) {
    const name = safeText(value, "仓库名称");
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === "." || name === "..") {
      throw new Error("仓库名称须为 1–100 个英文字母、数字、点、下划线或短横线，不能是 . 或 ..");
    }
    return name;
  }

  function parseRepoUrl(value) {
    const input = safeText(value, "源仓库地址");
    // Match the original text so URL normalization cannot silently accept ../ subpages.
    const match = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/?$/i.exec(input);
    if (!match) throw new Error("请使用 https://github.com/owner/repo 格式的仓库主页地址");
    const owner = match[1];
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner) || owner.includes("--")) {
      throw new Error("GitHub 用户名或组织名无效");
    }
    const repo = validateRepoName(match[2].replace(/\.git$/i, ""));
    const fullRepo = `${owner}/${repo}`;
    return { owner, repo, fullRepo, cloneUrl: `https://github.com/${fullRepo}.git` };
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function defaultTargetName(repo, suffix) {
    // GitHub repository names are limited to 100 characters, including our suffix.
    const tail = suffix.slice(0, 99);
    return validateRepoName(repo.slice(0, 100 - tail.length) + tail);
  }

  function validateLocalDir(value) {
    const directory = safeText(value, "本地目录");
    if (!directory || directory.length > 4096 || (directory.startsWith("~") && directory !== "~" && !directory.startsWith("~/"))) {
      throw new Error("本地目录不能为空；主目录请使用 ~ 或 ~/ 开头的路径");
    }
    return directory;
  }

  function normalizeSettings(settings) {
    const input = settings && typeof settings === "object" ? settings : {};
    const result = { ...DEFAULT_SETTINGS };
    if (typeof input.defaultSuffix === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(input.defaultSuffix)) {
      result.defaultSuffix = input.defaultSuffix;
    }
    try {
      if (typeof input.defaultLocalDir === "string") result.defaultLocalDir = validateLocalDir(input.defaultLocalDir);
    } catch (_) { /* Keep the safe default for invalid saved settings. */ }
    if (typeof input.autoSubmit === "boolean") result.autoSubmit = input.autoSubmit;
    return result;
  }

  function shellQuote(value) {
    return "'" + value.replace(/'/g, "'\\''") + "'";
  }

  function buildCliScript({ sourceUrl, targetName, localDir } = {}) {
    const source = parseRepoUrl(sourceUrl).cloneUrl;
    const name = validateRepoName(targetName);
    // localDir is the user's base directory; both UI entry points pass the same setting.
    const baseDirectory = validateLocalDir(localDir);
    const directory = `${baseDirectory.replace(/\/+$/, "")}/${name}`;
    const body = `set -euo pipefail
export GH_HOST=github.com
SOURCE_URL=${shellQuote(source)}
TARGET_NAME=${shellQuote(name)}
REQUESTED_LOCAL_DIR=${shellQuote(directory)}

fail() { printf '%s\\n' "$*" >&2; exit 1; }
git_auth() { git -c credential.helper= -c 'credential.helper=!gh auth git-credential' "$@"; }
assert_private() {
  local visibility
  visibility="$(gh repo view "$TARGET_REPO" --json isPrivate --jq .isPrivate)"
  [[ "$visibility" == true ]] || fail '目标仓库不是私有仓库，已停止。'
}
assert_empty_remote() {
  local refs
  refs="$(git_auth ls-remote "$TARGET_URL")"
  [[ -z "$refs" ]] || fail '目标远端已存在分支或标签，已停止，避免改动已有内容。'
}

command -v gh >/dev/null 2>&1 || fail '请先安装并登录 GitHub CLI (gh)。'
command -v git >/dev/null 2>&1 || fail '请先安装 Git。'
gh auth status --hostname github.com >/dev/null
TARGET_OWNER="$(gh api --hostname github.com user --jq .login)"
[[ "$TARGET_OWNER" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$ ]] || fail '无法取得有效的 GitHub 登录账号，已停止。'
TARGET_REPO="$TARGET_OWNER/$TARGET_NAME"
TARGET_URL="https://github.com/$TARGET_REPO.git"

case "$REQUESTED_LOCAL_DIR" in
  '~') LOCAL_DIR="$HOME" ;;
  '~/'*) LOCAL_DIR="$HOME/\${REQUESTED_LOCAL_DIR#\\~/}" ;;
  *) LOCAL_DIR="$REQUESTED_LOCAL_DIR" ;;
esac
case "$LOCAL_DIR" in
  /*) ;;
  *) LOCAL_DIR="$PWD/$LOCAL_DIR" ;;
esac
[[ ! -e "$LOCAL_DIR" && ! -L "$LOCAL_DIR" ]] || fail '本地目标目录已存在，已停止，原文件不会被覆盖。'
mkdir -p -- "$(dirname -- "$LOCAL_DIR")"
# Claim the destination atomically; clone may only write into the directory we created.
mkdir -- "$LOCAL_DIR"
cleanup() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then rmdir -- "$LOCAL_DIR" 2>/dev/null || true; fi
}
trap cleanup EXIT

gh repo create "$TARGET_REPO" --private --description 'Private Git copy'
assert_private
assert_empty_remote
git_auth clone --origin upstream -- "$SOURCE_URL" "$LOCAL_DIR"
cd -- "$LOCAL_DIR"
SOURCE_DEFAULT_BRANCH="$(git symbolic-ref --short HEAD)"
git_auth fetch upstream --tags

# A normal clone creates only the default local branch. Materialize all other branches.
REMOTE_BRANCHES="$(git for-each-ref --format='%(refname) %(symref)' refs/remotes/upstream/)"
while IFS=' ' read -r remote_ref symbolic_ref; do
  [[ -n "$remote_ref" && -z "$symbolic_ref" ]] || continue
  branch="\${remote_ref#refs/remotes/upstream/}"
  if ! git show-ref --verify --quiet "refs/heads/$branch"; then
    git branch --no-track -- "$branch" "$remote_ref"
  fi
done <<< "$REMOTE_BRANCHES"

git remote add origin "$TARGET_URL"
git remote set-url --push upstream DISABLED
LFS_AVAILABLE=0
if command -v git-lfs >/dev/null 2>&1; then
  git_auth lfs fetch --all upstream
  LFS_AVAILABLE=1
else
  printf '%s\\n' '未安装 git-lfs：本次仅复制 Git 分支和标签；如源仓库使用 LFS，大文件需另行迁移。'
fi

assert_private
assert_empty_remote
if [[ "$LFS_AVAILABLE" == 1 ]]; then git_auth lfs push --all origin; fi
assert_private
git_auth push -u origin --all
assert_private
git_auth push origin --tags
assert_private
gh repo edit "$TARGET_REPO" --default-branch "$SOURCE_DEFAULT_BRANCH"
printf '%s\\n' "Git 分支和标签已复制到私有仓库：https://github.com/$TARGET_REPO"
printf '%s\\n' '这不是完整项目备份：Issues、PR、仓库设置等不包含在 Git 复制中。'
`;
    return "bash <<'F2P_PRIVATE_COPY_SCRIPT'\n" + body + "F2P_PRIVATE_COPY_SCRIPT\n";
  }

  const api = Object.freeze({ parseRepoUrl, validateRepoName, escapeHtml, normalizeSettings, defaultTargetName, buildCliScript });
  root.F2P = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
