"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");
const F2P = require("../shared.js");

const REAL_GIT = execFileSync("/bin/sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "f2p-shared-cli-"));
const sourceWork = path.join(fixtureRoot, "source-work");
const sourceBare = path.join(fixtureRoot, "source.git");
const fixtureHome = path.join(fixtureRoot, "fixture-home");
fs.mkdirSync(sourceWork);
fs.mkdirSync(fixtureHome);
const gitEnvironment = {
  ...process.env,
  HOME: fixtureHome,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid"
};
function git(args, cwd = sourceWork) {
  return execFileSync(REAL_GIT, ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd, env: gitEnvironment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}
git(["init", "-b", "trunk"]);
fs.writeFileSync(path.join(sourceWork, "README.md"), "fixture\n");
git(["add", "."]);
git(["commit", "-m", "root"]);
git(["tag", "v1"]);
git(["checkout", "-b", "feature"]);
fs.writeFileSync(path.join(sourceWork, "feature.txt"), "feature\n");
git(["add", "."]);
git(["commit", "-m", "feature"]);
git(["tag", "-a", "feature-release", "-m", "annotated fixture tag"]);
git(["checkout", "trunk"]);
git(["checkout", "-b", "topic/nested"]);
fs.writeFileSync(path.join(sourceWork, "nested.txt"), "nested branch\n");
git(["add", "."]);
git(["commit", "-m", "nested"]);
git(["checkout", "trunk"]);
git(["clone", "--bare", sourceWork, sourceBare]);
test.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

const wrapperPrelude = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const env = process.env;
const args = process.argv.slice(2);
const record = (kind, extra={}) => fs.appendFileSync(env.F2P_LOG, JSON.stringify({kind,args,cwd:process.cwd(),ghHost:env.GH_HOST,...extra})+'\\n');
const realGit = a => {
  const result=spawnSync(env.F2P_REAL_GIT,['-c','core.hooksPath=/dev/null',...a],{env,encoding:'utf8'});
  if(result.stdout) process.stdout.write(result.stdout);
  if(result.stderr) process.stderr.write(result.stderr);
  return result.status ?? 90;
};
`;

const ghWrapper = wrapperPrelude + `
record('gh');
if(env.GH_HOST !== 'github.com') process.exit(89);
if(args[0]==='auth' && args[1]==='status') process.exit(env.F2P_MODE==='auth-failure'?41:0);
if(args[0]==='api') { console.log('fixture-user'); process.exit(0); }
if(args[0]==='repo' && args[1]==='create') {
  if(env.F2P_MODE==='create-failure') process.exit(42);
  if(args[2]!=='fixture-user/copy' || !args.includes('--private')) process.exit(88);
  const status=realGit(['init','--bare',env.F2P_TARGET]);
  if(status) process.exit(status);
  if(env.F2P_MODE==='nonempty-remote') process.exit(realGit(['-C',env.F2P_SOURCE,'push',env.F2P_TARGET,'refs/heads/trunk:refs/heads/existing']));
  process.exit(0);
}
if(args[0]==='repo' && args[1]==='view') {
  const counter=env.F2P_LOG+'.views';
  const n=fs.existsSync(counter)?Number(fs.readFileSync(counter,'utf8'))+1:1;
  fs.writeFileSync(counter,String(n));
  if(env.F2P_MODE==='view-failure') process.exit(43);
  console.log(env.F2P_MODE==='public-first' || (env.F2P_MODE==='public-before-push' && n>=2) ? 'false':'true');
  process.exit(0);
}
if(args[0]==='repo' && args[1]==='edit') {
  if(env.F2P_MODE==='default-branch-failure') process.exit(48);
  if(args[2]!=='fixture-user/copy' || args[3]!=='--default-branch' || args[4]!=='trunk') process.exit(84);
  process.exit(realGit(['--git-dir='+env.F2P_TARGET,'symbolic-ref','HEAD','refs/heads/'+args[4]]));
}
console.error('Unexpected gh call',args); process.exit(87);
`;

const gitWrapper = wrapperPrelude + `
const rest=[...args]; const configs=[];
while(rest[0]==='-c') { rest.shift(); configs.push(rest.shift()); }
const command=rest[0]; record('git',{command,configs});
const network=['ls-remote','clone','fetch','push','lfs'].includes(command);
if(network && (!configs.includes('credential.helper=') || !configs.includes('credential.helper=!gh auth git-credential'))) process.exit(86);
if(command==='clone' && env.F2P_MODE==='clone-failure') process.exit(44);
if(command==='fetch' && env.F2P_MODE==='fetch-failure') process.exit(45);
if(command==='ls-remote' && env.F2P_MODE==='remote-check-failure') process.exit(46);
if(command==='lfs') process.exit(env.F2P_MODE==='lfs-failure'?47:0);
// Known GitHub URLs are rewritten per command to local fixtures. No global config or network.
for(const arg of rest) if(/^https?:/.test(arg) && !['https://github.com/example/source.git','https://github.com/fixture-user/copy.git'].includes(arg)) process.exit(85);
process.exit(realGit([
  '-c','protocol.file.allow=always',
  '-c','url.'+env.F2P_SOURCE+'.insteadOf=https://github.com/example/source.git',
  '-c','url.'+env.F2P_TARGET+'.insteadOf=https://github.com/fixture-user/copy.git',
  ...args
]));
`;

function fixture(mode = "success", lfs = false) {
  const root = fs.mkdtempSync(path.join(fixtureRoot, "case-"));
  const bin = path.join(root, "bin"), home = path.join(root, "home");
  fs.mkdirSync(bin); fs.mkdirSync(home);
  const log = path.join(root, "calls.jsonl");
  fs.writeFileSync(log, "");
  for (const [name, source] of Object.entries({ gh: ghWrapper, git: gitWrapper })) {
    fs.writeFileSync(path.join(bin, name), source, { mode: 0o755 });
  }
  for (const name of ["bash", "mkdir", "dirname", "rmdir"]) {
    const target = ["/bin/" + name, "/usr/bin/" + name].find(candidate => fs.existsSync(candidate));
    fs.symlinkSync(target, path.join(bin, name));
  }
  if (lfs) fs.writeFileSync(path.join(bin, "git-lfs"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const env = {
    ...gitEnvironment, HOME: home, PATH: bin,
    GH_HOST: "wrong.example.invalid", F2P_REAL_GIT: REAL_GIT,
    F2P_LOG: log, F2P_MODE: mode,
    F2P_SOURCE: sourceBare, F2P_TARGET: path.join(root, "target.git")
  };
  return { root, home, env, log, calls() { return fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); } };
}

function runScript(context, shell, localDir) {
  const script = F2P.buildCliScript({ sourceUrl: "https://github.com/example/source.git/", targetName: "copy", localDir });
  return spawnSync(shell, ["-f"], { cwd: context.root, env: context.env, input: script, encoding: "utf8", timeout: 30000 });
}
function refs(repository) {
  return git(["--git-dir=" + repository, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/", "refs/tags/"]);
}

test("validators reject non-repository URLs, credentials, controls and shell metacharacters", () => {
  assert.equal(Object.isFrozen(F2P), true);
  assert.equal(globalThis.F2P, F2P);
  assert.deepEqual(F2P.parseRepoUrl(" https://github.com/Example/repository.git/ "), {
    owner: "Example", repo: "repository", fullRepo: "Example/repository", cloneUrl: "https://github.com/Example/repository.git"
  });
  for (const value of [
    "http://github.com/example/repo", "https://github.com.evil.invalid/example/repo", "https://token@github.com/example/repo",
    "https://github.com/example/repo/tree/main", "https://github.com/example/repo?x=1", "https://github.com/example/repo#x",
    "https://github.com/example/../repo", "https://github.com/example/%72epo", "https://github.com/example/repo\n",
    "https://github.com/owner--invalid/repo"
  ]) assert.throws(() => F2P.parseRepoUrl(value), undefined, value);
  for (const value of [".", "..", "", "a".repeat(101), "x$(printf bad)", "x;printf bad", "a\nb", "a\tb", "x\u007f"]) {
    assert.throws(() => F2P.validateRepoName(value));
  }
  assert.equal(F2P.validateRepoName(" valid._-123 "), "valid._-123");
  for (const localDir of ["a\nb", "a\rb", "a\u0000b", "a\u0085b", "~another-user/folder"]) {
    assert.throws(() => F2P.buildCliScript({ sourceUrl: "https://github.com/example/source", targetName: "copy", localDir }));
  }
});

test("saved settings safely fall back and HTML values are escaped", () => {
  assert.deepEqual(F2P.normalizeSettings(null), { defaultSuffix: "-private", defaultLocalDir: "~/Projects", autoSubmit: true });
  assert.deepEqual(F2P.normalizeSettings({ defaultSuffix: "<b>", defaultLocalDir: "x\ny", autoSubmit: "false" }), F2P.normalizeSettings());
  assert.deepEqual(F2P.normalizeSettings({ defaultSuffix: "_mine", defaultLocalDir: "~/A B", autoSubmit: false }), {
    defaultSuffix: "_mine", defaultLocalDir: "~/A B", autoSubmit: false
  });
  assert.equal(F2P.escapeHtml(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
});

for (const shell of ["/bin/bash", "/bin/zsh"].filter(value => fs.existsSync(value))) {
  const label = path.basename(shell);
  test(`${label}: copies every branch and tag from a non-main default with safe ~/ and quoted paths`, () => {
    const context = fixture();
    const relative = "Projects/space 'quote' $(printf INJECTED > SHOULD_NOT_EXIST)";
    const result = runScript(context, shell, "~/" + relative);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const local = path.join(context.home, relative, "copy");
    assert.equal(fs.existsSync(path.join(local, ".git")), true);
    assert.equal(fs.existsSync(path.join(context.root, "SHOULD_NOT_EXIST")), false);
    assert.equal(refs(context.env.F2P_TARGET), refs(sourceBare));
    assert.equal(git(["--git-dir=" + context.env.F2P_TARGET, "symbolic-ref", "HEAD"]), git(["--git-dir=" + sourceBare, "symbolic-ref", "HEAD"]));
    assert.equal(git(["symbolic-ref", "--short", "HEAD"], local), "trunk");
    assert.equal(git(["remote", "get-url", "origin"], local), "https://github.com/fixture-user/copy.git");
    assert.equal(git(["remote", "get-url", "--push", "upstream"], local), "DISABLED");
    const calls = context.calls();
    assert.ok(calls.find(call => call.kind === "gh" && call.args[0] === "api" && call.args.includes(".login")));
    assert.ok(calls.every(call => call.ghHost === "github.com"));
    assert.match(result.stdout, /未安装 git-lfs/);
    assert.match(result.stdout, /不是完整项目备份/);
  });

  test(`${label}: installed LFS uses authenticated fetch and push`, () => {
    const context = fixture("success", true);
    const result = runScript(context, shell, "~/Projects");
    assert.equal(result.status, 0, result.stderr);
    const lfs = context.calls().filter(call => call.command === "lfs");
    assert.equal(lfs.length, 2);
    assert.deepEqual(lfs.map(call => call.args.slice(-4)), [["lfs", "fetch", "--all", "upstream"], ["lfs", "push", "--all", "origin"]]);
    assert.equal(refs(context.env.F2P_TARGET), refs(sourceBare));
  });

  test(`${label}: relative paths resolve against the invocation directory`, () => {
    const context = fixture();
    const result = runScript(context, shell, "relative folder");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(context.root, "relative folder/copy/.git")), true);
    assert.equal(refs(context.env.F2P_TARGET), refs(sourceBare));
  });

  for (const mode of ["auth-failure", "create-failure", "public-first", "view-failure", "nonempty-remote", "remote-check-failure", "clone-failure", "fetch-failure", "public-before-push", "lfs-failure"]) {
    test(`${label}: ${mode} stops before any Git push`, () => {
      const context = fixture(mode, mode === "lfs-failure");
      const result = runScript(context, shell, "~/Projects");
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.equal(context.calls().some(call => call.command === "push"), false);
      assert.doesNotMatch(result.stdout, /Git 分支和标签已复制/);
      if (["create-failure", "public-first", "view-failure", "nonempty-remote", "remote-check-failure"].includes(mode)) {
        assert.equal(context.calls().some(call => call.command === "clone"), false);
      }
    });
  }

  test(`${label}: exact ~ base expands into HOME/copy`, () => {
    const context = fixture();
    const result = runScript(context, shell, "~");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(context.home, "copy/.git")), true);
    assert.equal(refs(context.env.F2P_TARGET), refs(sourceBare));
  });

  test(`${label}: failure to preserve the default branch does not report success`, () => {
    const context = fixture("default-branch-failure");
    const result = runScript(context, shell, "~/Projects");
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(context.calls().filter(call => call.command === "push").length, 2);
    assert.equal(context.calls().some(call => call.kind === "gh" && call.args[1] === "edit"), true);
    assert.doesNotMatch(result.stdout, /Git 分支和标签已复制/);
  });

  test(`${label}: existing destination under a base directory is rejected without changing files`, () => {
    for (const exactHome of [false, true]) {
      const context = fixture();
      const base = exactHome ? context.home : path.join(context.root, "existing");
      const local = path.join(base, "copy");
      fs.mkdirSync(local, { recursive: true });
      const marker = path.join(local, "keep.txt");
      fs.writeFileSync(marker, "user contents\n");
      const result = runScript(context, shell, exactHome ? "~" : base);
      assert.notEqual(result.status, 0);
      assert.equal(fs.readFileSync(marker, "utf8"), "user contents\n");
      assert.equal(context.calls().some(call => call.kind === "gh" && call.args[1] === "create"), false);
      assert.equal(context.calls().some(call => call.command === "clone"), false);
    }
  });
}
