# 阶段 4 的提交信息（执行判据）

提交信息是交付物的一部分：它会被 `git log`、`git blame`、release note 长期读取。格式错了事后只能重写历史，所以在 commit 之前就要定下来。

本文件是本仓库提交规范的唯一出处：先判断该用哪套规范，没有项目自有规范时用下面的兜底格式。

## 先判断用哪套规范

固定顺序，不要跳过第一步：

1. **目标项目自带规范优先**。按下面顺序找，找到哪套就照哪套写，**不要再套本文件的默认值**：
   - `CONTRIBUTING.md` 里的提交信息章节
   - `.gitmessage` / `.gitmessage.txt`
   - `commitlint.config.{js,cjs,mjs,ts}`、`.commitlintrc.*`（看 `type-enum` 与 `rules`）
   - `package.json` 里的 `commitlint`、`husky`、`simple-git-hooks` 配置
   - 最近 20 条 `git log` 的实际风格（团队实际习惯常与文档不一致，以实际为准）
2. **都没有才用兜底格式**：`<type>(<scope>): <description>`，即 Conventional Commits 1.0.0。

兜底的 type 取值：`feat` / `fix` / `docs` / `refactor` / `perf` / `test` / `build` / `ci` / `chore` / `revert`。`update`、`change`、`modify`、`wip` 不是合法 type。

写法：`description` 祈使语气、小写开头、不加句号（中文同样适用——写「删除重复说明」而不是「删除了重复说明」）；`scope` 写受影响的模块或目录；一次提交只做一件事；正文写**为什么改**和**影响什么**，不复述 diff；破坏性变更在 type 后加 `!` 并在 footer 写 `BREAKING CHANGE:`。

判断把握不大时按第 1 步的实际风格写，不要自己发明新格式。

### type 怎么选

| type | 用途 |
| --- | --- |
| `feat` | 新增能力（规则、脚本、模板、参考文档） |
| `fix` | 修正错误（脚本行为、文档事实错误） |
| `docs` | 只改文档，不影响行为 |
| `refactor` | 重构，不改变外部行为 |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `build` | 构建或依赖变更 |
| `ci` | CI 配置 |
| `chore` | 杂项（不影响源码与测试） |
| `revert` | 回滚既有提交 |

### 示例

```
feat(figma): 支持多状态一次提交出稿
docs(readme): 删除流程表后重复的设计阶段说明
fix(capture): captureId 重复消费时给出明确报错

BREAKING CHANGE: 不再等阶段 2 才做授权，
调用方需要在进入阶段 1 前先跑 figma-auth.js check。
```

### 校验

仓库根的 `commitlint.config.mjs` 用 `extends: @commitlint/config-conventional` 固化以上规则（`type-enum`、`header-max-length: 100`，中文无大小写故关掉 `subject-case`）。它只是规则声明，不是运行依赖——`clone` 下来不装也能跑 skill，装它纯粹为了 commit 前先自验一遍：

```bash
npm i -D @commitlint/cli@19 @commitlint/config-conventional@19   # 一次性
echo "feat(figma): 支持多状态一次提交出稿" | npx commitlint --config commitlint.config.mjs
```

退出码 0 即通过。

## 和「不可逆动作先问」配合

SKILL.md 规则 5 要求 commit/push 前停下确认。**确认的那一刻就要把拟用提交信息原文贴出来**，格式：

```
准备提交 N 个文件：
  <file1>
  <file2>

拟用提交信息：
  fix(capture): captureId 重复消费时给出明确报错

确认后执行 commit 并 push 到 <branch>。
```

用户能在提交发生前就改格式，而不是事后要求重写历史。不要先 commit 再解释格式。

## 一次需求通常对应多条提交

开发阶段按技术方案的开发内容表逐步推进，提交也应该按语义单元拆开，而不是攒到最后来一条 `feat: 实现整个需求`。每条提交对应一个或几个相邻步骤，各自能独立编译。测试、验收阶段改到代码时单独提交，并在信息里点明修的是哪条缺陷或哪条评审意见。

## 已在远端的错误提交

- **只有自己在用、没人基于它开发**：可以用 `git commit-tree` 逐条重建（保留作者与时间戳），再 `--force-with-lease` 推送。重建后核对 `git log --format="%T"` 的 tree hash 与原提交一致，证明只改了消息、没动内容。
- **已经有人在用**：不要 force push。由用户决定是补一条说明性提交还是接受现状。
