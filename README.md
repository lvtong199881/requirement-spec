# requirement-spec

基于 skill 的需求规范驱动开发，包含产品需求、设计、技术方案、开发、代码评审、测试、验收、复盘等 8 个阶段。

这是一个给 AI coding agent 用的 **skill**（技能包）：它把整条需求链路固化成可执行的流程，而不是让 agent 每次凭感觉发挥。

## 它解决什么问题

让 agent 写功能，通常卡在三个地方：

1. **流程不稳**——跳过设计直接写代码，跳过评审直接说"完成了"。
2. **产物不齐**——只有代码，没有 PRD、没有验收标准，出问题无从对账。
3. **自评失真**——写代码的人自己验收，当然说通过。

这个 skill 用三道约束回应：每个阶段有**准出标准**（不达标不进入下一环）；关键环节由**独立子 agent** 把关（评审 agent 当同事工程师、验收 agent 当产品经理）；每份产物都要求能**追到需求编号**。

## 流程

| 阶段 | 做什么 | 产出 |
| --- | --- | --- |
| 1 产品需求 | 复述需求、提问所有会改变范围的疑点、列场景与 REQ 编号、边界异常、监测指标 | 需求卡片 + PRD |
| 2 设计 | 以 `design-spec.json` 为设计源，派生页面 HTML 与 PNG，出 Figma 设计稿 | 设计说明 + Figma 稿 |
| 3 技术方案 | 接口定义、影响面、风险、改动点关联 REQ | 技术方案 |
| 4 开发 | 按项目规范实现，同步更新开发内容状态 | 代码 + 变更说明 |
| 5 代码评审与修正 | 起评审 agent 评审，主流程逐条判定修正，同一 agent 复审 | 评审报告 + 修正后代码 |
| 6 测试 | 构建、单测、UI 测试、主流程实跑、监测日志校验 | 测试报告 + 归档截图 |
| 7 验收 | 起验收 agent 独立复核，再逐条对照验收标准 | 验收文档 |
| 8 复盘 | 按需 | 复盘记录 |

每阶段的详细准出清单见 [`references/templates.md`](references/templates.md)。

## 安装

把整个目录放进你的 skills 目录：

```bash
git clone https://github.com/lvtong199881/requirement-spec.git ~/.dsh/skills/requirement-spec
```

然后用 `$requirement-spec` 显式调用，或在产品级需求上让 agent 自动选用。**显式调用时走完整流程、不做规模裁剪**；自动调用才按 S/M/L 分档。

## 依赖

- **Node.js** ≥ 18（脚本用到 `node:fs/promises`、`fetch`）
- **Chrome / Chromium / Edge**（无头渲染用；可用 `CHROME_PATH` 指定）
- **Figma 账号**（免费 Starter 即可）

脚本无第三方 npm 依赖，clone 下来直接能跑。

## 目录结构

```
SKILL.md                  # 入口：规则、流程表、落盘约定
references/
  requirements.md         # 阶段 1：澄清判据、REQ 编号、歧义扫描
  design.md               # 阶段 2：出稿流程、状态覆盖、归档
  figma.md                # 阶段 2：MCP 通道、授权、限流、spec 结构
  review.md               # 阶段 5：评审 agent 角色卡与协议
  commits.md              # 阶段 4：提交信息规范的判断依据
  verify.md               # 阶段 6-7：测试要求、验收 agent、追溯矩阵
  templates.md            # 全阶段模板与准出清单
assets/
  figma-*.js              # 授权预检、渲染、截图、捕获、编译
  figma-plugin/           # 本地 Figma 插件骨架（手动导入兜底）
```

## 免责

skill 本身不含任何凭据。Figma token 由 `mcp-remote` 存在 `~/.mcp-auth/`，不会进仓库；仓库里也没有硬编码的个人路径或账号信息。

## 贡献

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/)，
格式 `<type>(<scope>): <description>`，详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

MIT
