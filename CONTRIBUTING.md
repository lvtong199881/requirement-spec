# 贡献指南

## 提交信息：Conventional Commits

本仓库遵循 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/zh-hans/v1.0.0/)。
每条提交信息必须写成：

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### 允许的 type

| type | 用途 |
| --- | --- |
| `feat` | 新增能力（skill 规则、脚本、模板、参考文档） |
| `fix` | 修正错误（脚本行为、文档事实错误） |
| `docs` | 只改文档，不影响行为 |
| `refactor` | 重构，不改变外部行为 |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `build` | 构建或依赖变更 |
| `ci` | CI 配置 |
| `chore` | 杂项（不影响源码与测试） |
| `revert` | 回滚既有提交 |

### 约定

- `description` 用小写开头、祈使语气、不加句号；中文同样适用。
- `scope` 可选，用于指明范围，如 `docs(readme)`、`feat(figma)`。
- **破坏性变更**在 type 后加 `!`（如 `feat(figma)!: ...`），并在 footer 写
  `BREAKING CHANGE: <说明>`。
- 正文与 footer 之间空一行；正文可写动机与影响，不要复述 diff。
- 不许出现 `update`、`修改一下`、`fix bug` 这类无信息量的描述。

### 校验

仓库自带 `commitlint.config.mjs`。装了 commitlint 时可直接校验一条信息：

```bash
echo "feat(figma): 支持多状态一次提交出稿" | npx commitlint --config commitlint.config.mjs
```

没装也不影响贡献——这个文件只是规则声明，不是运行依赖。

### 示例

```
feat(figma): 支持多状态一次提交出稿
docs(readme): 删除流程表后重复的设计阶段说明
fix(capture): captureId 重复消费时给出明确报错
fix(auth)!: 改为任务开局即校验 token

BREAKING CHANGE: 不再等阶段 2 才做授权，
调用方需要在进入阶段 1 前先跑 figma-auth.js check。
```
