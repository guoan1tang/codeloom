# CodeLoom

简体中文 | [English](README.en.md)

[![CI](https://github.com/guoan1tang/codeloom/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/guoan1tang/codeloom/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

面向 Agent 的代码知识图谱。把任意 Git 仓库索引成方法级调用图，跨仓库拼接服务契约（Feign / HTTP / MQ），再通过 MCP 交给编码 Agent 使用。

**零原生依赖。** 解析用 tree-sitter WASM，存储用 Node 内置 SQLite，MCP 用官方 SDK。不需要编译、不需要数据库服务、不需要 Docker。代码不出本机。

## 安装

需要 Node >= 22.13 与 Git。

`codeloom-cli` npm 包尚未发布，暂时直接从 GitHub 安装：

```bash
npx -y github:guoan1tang/codeloom analyze <path|git-url>
claude mcp add codeloom -- npx -y github:guoan1tang/codeloom mcp
```

这种方式会 clone 仓库并用 Node 运行，不需要 registry 账号。

npm 包发布后：

```bash
npx codeloom-cli analyze https://github.com/you/your-service.git   # 也可以传本地路径
claude mcp add codeloom -- npx -y codeloom-cli mcp
npm i -g codeloom-cli
```

## Web 界面

```bash
codeloom serve                 # http://127.0.0.1:3111
```

基于实时索引的浏览器界面。默认是服务树——一次看一个服务（可切换）：服务根 → API / MQ / JOB 分组 → 条目（含提供方方法与跨服务消费方，可展开）；点击任意一行可查看本地代码的真实片段。界面还包含影响分析、从树中条目打开的跨仓库链路弹窗（泳道回放、真实契约）、Agent 回路（提交 / diff → 影响 → 精确测试选择）、仓库管理（添加 / 重建 / 删除），以及与 MCP 共用引擎的查询控制台。只监听 127.0.0.1——索引留在本地。

## 配置（全局，界面或文件）

在 Web 界面打开 **Repositories → 全局配置**，编辑网关前缀规则与框架适配。全局配置存在图数据库中，索引时对所有仓库生效；保存后可一键重建全部索引。

单仓库的 `codeloom.config.json` 仍然支持，仅用于例外仓库（优先级：默认 < 全局 < 仓库文件）。

### 配置项

在仓库根目录放 `codeloom.config.json` 来适配框架约定（所有键可选，默认按通用 Spring 约定）：

```json
{
  "httpWrappers": ["HttpApi", "request"],
  "pathAliases": { "@src/*": "src/*", "@/*": "src/*" },
  "pageDirs": ["src/page", "src/pages", "src/views"],
  "jobAnnotations": ["Scheduled", "XxlJob", "ElasticSimpleJob"],
  "mqListenerAnnotations": ["RabbitListener", "KafkaListener"],
  "tableAnnotations": ["TableName", "Table"],
  "gatewayRouters": [{ "prefix": "/api-order", "strip": 1 }],
  "gatewayRoutesFile": "config/gateway-routes.yaml"
}
```

- `gatewayRouters` / `gatewayRoutesFile`（Spring Cloud Gateway yaml：`Path=/prefix/**` + `StripPrefix=n`）在索引时剥掉消费方路径中的服务前缀，让前端 / Feign 调用与后端端点对上。
- HTTP 封装可自动识别（import axios 的文件），也可以按标识符显式列出。

## CLI

```bash
codeloom analyze <path|git-url> [--name n] [--branch b] [--full] [--db path]
codeloom list
codeloom status [--json]
codeloom remove <name>
codeloom mcp [--db path]
codeloom serve [--port 3111] [--host 127.0.0.1]
```

- `analyze` 是增量的：内容未变的文件会被跳过。`--full` 全量重解析并刷新跨文件接口分派。
- 默认数据库：`~/.codeloom/graph.db`（可用 `--db` 或 `CODELOOM_DB` 覆盖）。
- 索引 URL 时会 clone 到临时目录，结束后删除；只保留图数据。

## MCP 工具

| 工具 | 用途 |
|---|---|
| `search_symbol` | 按名称、FQN 或路径查找方法 / 类型 / 端点 / Topic / 页面 / 测试 |
| `find_callers` / `find_callees` | 带深度限制的调用遍历，可按置信度过滤 |
| `impact_analysis` | 改动方法 → 入口点（HTTP、页面、MQ 消费、Job、测试） |
| `cross_repo_trace` | 围绕某个端点的提供方 / 消费方 / Topic 拼接 |
| `graph_query` | 单跳 Cypher 子集：`MATCH (a:Method)-[:CALLS]->(b) WHERE a.name='x' RETURN b` |
| `impact_of_diff` | 统一 diff（或本地仓库中的某个提交）→ 按入口点批量评估影响 |
| `tests_for_change` | 精确测试选择：单测 + 桥接的接口 / UI 用例 + 未覆盖风险 |
| `graph_status` | 各仓库已索引的提交、新鲜度告警、静态测试覆盖 |

数据层边：数据库表（MyBatis XML mapper、`@Select/@Insert/@Update/@Delete`、SQL 字符串字面量）通过 READS_TABLE / WRITES_TABLE；Redis / 缓存键通过 USES_CACHE；树中条目的链路弹窗会显示提供方方法下游的数据库 / Redis 泳道。

调用边带置信度：`certain`（直接调用）、`inferred`（唯一实现 / 依赖注入）、`speculative`（多个候选）。遍历默认取 certain + inferred；高扇入的工具方法会从影响链中截断（默认阈值 30，可配置）。

## 能提取什么

- **Java**：类 / 接口 / 方法、import、extends / implements、带接收者解析（字段、局部变量、参数、`new`）的调用点、Spring 依赖注入分派、`@RestController` 映射 → 端点、`@FeignClient` → 消费边、RocketMQ / Kafka 监听与生产发送 → Topic、`@Scheduled` → Job 入口、JUnit `@Test` / `src/test` → 测试节点。
- **TypeScript / JavaScript**：import、函数 / 类 / 方法、调用、`fetch` / `axios` / `http` 客户端调用 → 端点边、`src/pages|views` → 页面节点、jest `it()` / `test()` → 测试节点。
- **跨仓库**：端点与 Topic 是全局连接键——仓库 A 的 Feign 客户端与仓库 B 的 Controller 会落在同一个端点节点上。没有提供方的端点标记为外部边界。

## 语言包

一个语言包就是一个模块，导出 `extensions`、`grammar`（`tree-sitter-wasms` 的语法名）、`pass1(ctx, tree)`（符号 + 契约 + 调用点）与 `pass2Types` / `pass2Calls`（跨文件解析）。参考 `src/packs/java.js` 和 `src/packs/typescript.js`。新增一种语言 = 新增一个语言包；核心、存储、遍历和 MCP 接口都与语言无关。

## 已知限制（P0）

- 语法级解析：反射、AOP 代理、动态分派不可见。边表达的是代码声明，而不是运行时行为——置信度会暴露出来，供 Agent 判断。
- 网关路由改写尚未从网关仓库自动采集；消费方路径需在归一化后与提供方一致（`:id` / `{id}` / `${…}` → `{param}`）。
- 增量重解析只刷新变更文件的分派边；给已有接口新增实现后请用 `--full`。
- 重载方法会解析到第一个同名方法。
- 用例节点（`COVERS` 边）来自你的测试管理导出；桥接格式见 `src/graph.js`（`testsForChange`）。

## 能力测试

示例项目在 `test/fixtures/<name>/`，每个都带一个 `expect.json`，用声明式断言描述期望的图（边、节点属性、汇总数量），由 `test/harness/index.js` 执行。新增 fixture 不需要写测试代码——见 `test/fixtures/README.md`。

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。能力 fixture 放在 `test/fixtures/`——新增一种项目结构 = 一个目录 + 一个 `expect.json`，不用写测试代码。

## 开发

```bash
npm install --registry=https://registry.npmmirror.com   # 或你的 registry
npm test                                               # 40 个测试：fixture、MCP、API、性能冒烟
```

## 许可证

Apache-2.0