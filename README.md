# requirement-spec

基于 skill 的需求规范驱动开发，包含产品需求、设计、技术方案、开发、代码评审、测试、验收、复盘等 8 个阶段。

这是一个给 AI coding agent 用的 **skill**（技能包）：它把整条需求链路固化成可执行的流程，而不是让 agent 每次凭感觉发挥。

## 它解决什么问题

让 agent 写功能，通常卡在三个地方：

1. **流程不稳**——跳过设计直接写代码，跳过评审直接说"完成了"。
2. **产物不齐**——只有代码，没有 PRD、没有验收标准，出问题无从对账。
3. **自评失真**——写代码的人自己验收，当然说通过。

这个 skill 用三道约束回应：每个阶段有**准出标准**（不达标不进入下一环）；**每个阶段都由独立的执行 agent 产出**，主流程只做编排（提问、组装任务包、校验产物、判定评审意见、处理停点、提交），自己不写阶段产物；每份产物都要求能**追到需求编号**。

## 编排模型

主流程是项目经理，不产出台阶产物。8 个阶段各有一个独立子 agent，用 `subagent` 起（全新上下文，不用 `subagent_fork`）：

| 阶段 | 执行 agent | 相当于 |
| --- | --- | --- |
| 1 产品需求 | 需求 agent（S 级兼技术方案） | 需求侧产品经理 |
| 2 设计 | 设计 agent（**任何档位都不合并**） | UI 设计师 |
| 3 技术方案 | 方案 agent | 技术负责人 |
| 4 开发 | 开发 agent（承担全部代码修正） | 工程师 |
| 5 代码评审与修正 | 评审 agent 提意见、主流程判定、开发 agent 修、评审 agent 复审 | 同事工程师 |
| 6 测试 | 测试 agent | QA |
| 7 验收 | 验收 agent | 验收侧产品经理 |
| 8 复盘 | 复盘 agent | 数据分析 |

三条独立性地板：**开发、评审、测试永远是三个独立实例**（写代码的人不能评审自己，也不能自己出测试结论）；**界面有可见变化时验收 agent 必须独立起**；**commit / push 只由主流程在用户确认后执行**（不可逆动作不交给子 agent）。

实例数按**角色**算，不按环节算：同一个角色在同一需求里后续再发言（评审复审、开发修缺陷、需求 agent 定稿）都用 `send_message` 续跑原实例。复审不是新评审，新起一个评审 agent 会丢掉首次评审的上下文，变成"重评一遍"，问题清单只增不减、闭环不了。

交接只靠文件：下游 agent 拿不到上游的对话，产物必须落盘到 `docs/requirements/<需求标识>/`，用统一编号（REQ / AC / CR / OOS）互相引用。协议细节见 [references/0-orchestration/README.md](references/0-orchestration/README.md)。

## 流程

| 阶段 | 做什么 | 产出 |
| --- | --- | --- |
| 1 产品需求 | 复述需求、汇总待提问清单、列场景与 REQ 编号、边界异常、监测指标 | 需求卡片 + PRD + 待提问清单 |
| 2 设计 | 以 `design-spec.json` 为设计源，派生页面 HTML 与 PNG，出 Figma 设计稿 | 设计说明 + Figma 稿 |
| 3 技术方案 | 接口定义、影响面、风险、改动点关联 REQ | 技术方案 |
| 4 开发 | 按项目规范实现，写并跑单元测试，构建 debug 包，同步更新开发内容状态 | 代码 + 单元测试 + debug 包 + 变更说明 |
| 5 代码评审与修正 | 评审 agent 评审，主流程判定，开发 agent 修正，同一个评审 agent 复审（续跑） | 评审报告 + 修正后代码 |
| 6 测试 | 黑盒：debug 包装到模拟器/设备，UI 测试、主流程实跑、PRD 全覆盖、监测日志校验、截图归档 | 测试报告 + 归档截图 |
| 7 验收 | 验收 agent 独立复核，主流程合并交付说明 | 验收文档 |
| 8 复盘 | 按需 | 复盘记录 |

每个阶段一个目录，做法（含该阶段执行 agent 的角色卡）写在 `README.md`，该阶段的文档模板与准出清单写在同目录的 `templates.md`。

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
SKILL.md                  # 入口：规则、编排模型、流程表、落盘约定
references/
  0-orchestration/        # 编排协议：任务包/回执/校验返工/失败处理/遥测；templates 有施工单
  1-requirements/         # 阶段 1：需求 agent 角色卡、澄清判据/REQ 编号/歧义扫描，templates
  2-design/               # 阶段 2：设计 agent 角色卡、出稿流程/状态覆盖/归档，figma.md 通道与 spec，templates
  3-tech-plan/            # 阶段 3：方案 agent 角色卡、拆分粒度/接口定稿/影响面，templates
  4-development/          # 阶段 4：开发 agent 角色卡、提交信息规范，templates
  5-review/               # 阶段 5：评审 agent 角色卡与协议、三方分工，templates
  6-testing/              # 阶段 6：测试 agent 角色卡、测试要求/证据/截图归档，templates
  7-acceptance/           # 阶段 7：验收 agent 角色卡、设计稿核对/追溯矩阵，templates
assets/
  figma-*.js              # 授权预检、渲染、截图、捕获、编译
  figma-plugin/           # 本地 Figma 插件骨架（手动导入兜底）
  telemetry.js            # 运行遥测：阶段边界打点、效率报告、编排记录回填
```

## 使用效率统计

主流程在阶段边界打点，数据默认写到 `<仓库根>/docs/requirements/.telemetry/events.jsonl`——**git 仓库优先**，和需求产物同源，
能对着需求目录与 commit sha 做前后对比。脚本会自动把这行加进仓库的 `.gitignore`，所以数据只留在本地，
不会随 `git add -A` 被提交出去（需求标识与作者名是明文）。想让数据跟着 clone / push 流动，才把配置里的 `commit` 打开。
用来分析团队用这个 skill 的效率（阶段耗时、返工热点、评审误报率、缺陷逃逸率、停点分布、中断率），据此定位该改哪份角色卡或准出清单。

调用时用 skill 的绝对路径（脚本按主流程的 cwd 判断数据该归到哪个仓库，用相对路径会找不到脚本）：

```bash
node "$SKILL_DIR/assets/telemetry.js" where    # 先看数据会落到哪，确认遥测是通的
```

```bash
node "$SKILL_DIR/assets/telemetry.js" report                          # 出效率报告
node "$SKILL_DIR/assets/telemetry.js" report --json                   # 机器可读
node "$SKILL_DIR/assets/telemetry.js" parse --path docs/requirements  # 漏打点时从编排记录回填
```

协议（打点时机与四条铁律）见 [references/0-orchestration/README.md](references/0-orchestration/README.md) 的「遥测」一节。
数据只用于改进 skill 本身，**不建议用作个人绩效**——一旦变成考核，打点就会失真。
存储与治理（三种模式、脱敏开关）见 0-orchestration 的「隐私与治理」。

## 免责

skill 本身不含任何凭据。Figma token 由 `mcp-remote` 存在 `~/.mcp-auth/`，不会进仓库；仓库里也没有硬编码的个人路径或账号信息。

## 贡献

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/)，
格式 `<type>(<scope>): <description>`，详见 [references/4-development/README.md](references/4-development/README.md)。

## License

MIT
