# 让 Agent 跨仓库查代码：我做了个 MCP 知识图谱，同一问题省 46% token

> 备选标题：
> 1. 同一个问题，Claude Code 答不出来，接上这个 MCP 后答对了
> 2. 我给编码 Agent 装了一张「代码地图」，实测数据都在这里

事情的起点有点好笑：我订阅的 token 套餐快到期了，一看才用了 20%，想着「不能浪费」。于是给自己找了个理由——把额度用在一个真正值得做的东西上。

作为一个每天写业务的程序员，有两类问题反复出现：

- 写技术方案时，要评估「改这里会影响哪些接口、哪些页面、哪些表」
- 线上出故障时，要快速圈出「这个服务出问题，会波及哪些上游入口」

这两件事本质是同一个问题：**影响范围**。但现实里，它靠的是老员工的记忆，或者一个人肉 grep 半小时。IDE 的调用查找只在单仓库里管用，跨服务靠 Feign、MQ 连起来的关系，它看不见。

市面上的图谱工具，要么要装 Neo4j、Docker，要么闭源、限制商用；而且大多是画给人看的，Agent 用不上。

我想要的是另一种东西：**一个人类友好、Agent 也友好的代码知识图谱**。人能点开服务树、看见链路和注释；Agent 能通过 MCP 直接查调用链、影响面和测试清单。

这就是 **CodeLoom**：tree-sitter 解析代码 → 本地 SQLite 图谱 → 同时提供 Web 界面和 MCP。对人和 Agent 来说，缺的都是同一样东西：不是文件，是文件之间的关系。

## 它到底有没有用，我做了对照实验

不吹「提效 10 倍」。方法写清楚：同一个 Claude Code CLI、同一个模型、同一组问题，唯一变量是**有没有接 CodeLoom**。两条臂都只允许读文件 / 搜索（Read、Grep、Glob），禁用 Bash；记录耗时、token（含缓存读写）、费用、读文件数和答案正确性。

### 实验一：单仓库，ruoyi-vue-pro（7,673 个 Java 文件）

问题：`GET /system/user/page` 的完整调用链，以及它读了哪些表。

- 不接 CodeLoom：**114 秒**，25.9 万 token，grep 16 次、读 3 个文件
- 接上 CodeLoom：**82 秒（快 28%）**，23.5 万 token，读 2 个文件
- 两边答案都对；接上后额外标出了「哪张表是条件分支才会查」

同一项目的第二个问题（改 `AdminUserServiceImpl.updateUser` 影响哪些接口）：

- 不接：59 秒，7.1 万 token，读 1 个文件
- 接上：**47 秒，0 个源码文件**

**结论要说实话**：单仓库里，它稳定快 20–30%，能不看源码直接回答；但 **token 没有优势** —— 9 个 MCP 工具的说明书，每次会话要额外写 15–20k 缓存 token，短会话里这是净开销。

### 实验二：两个仓库，mall4cloud（order / product 拆开）

这才是它真正的主场。我把 `mall4cloud-order` 和 `mall4cloud-product` 拆成两个独立仓库，模拟真实的多仓布局，然后问最开始那个问题。

| | 只打开 order（日常状态） | 两个仓库都打开（最强基线） | **CodeLoom（只打开 order）** |
|---|---|---|---|
| 耗时 | 37.7s | 68.1s | **46.3s** |
| token | 105,876 | 164,514 | **89,511** |
| 费用 | $0.13 | $0.21 | $0.16 |
| 读文件 | 2 | 3 | **1** |
| 答案 | ❌ 答不出，或凭记忆猜错 | ✅ 3 张表 | ✅ **3 张表 + 完整链路** |

![跨仓库场景的实测数据](article-assets/fig2.png)

对比「两个仓库都检出」的最强基线：**省 32% 时间、46% token、22% 费用**。

对比日常「只开当前仓库」的状态：基线根本给不出可信答案，CodeLoom 给的是：

```
POST /skuStockLock/lock
└─ SkuStockLockFeignController.lock()        product 服务
   └─ SkuStockLockServiceImpl.lock()
      ├─ sku_stock        UPDATE 扣减 SKU 库存
      ├─ spu_extension    UPDATE 扣减 SPU 总库存
      └─ sku_stock_lock   INSERT 库存锁定记录
```

每一跳都带文件行号和中文注释。

**为什么这里 token 反而省了**：省的不是工具调用，是**不用把另一个仓库的源码读进上下文**。两个实验放在一起看，才是完整结论：

- 单仓库、命名规范：省时间，不省 token
- 多仓库、契约跨服务：正确性和 token 都明显占优

## 它是怎么做到的

不装 Docker、不跑 Neo4j、不需要 JDK：

- 解析：tree-sitter WASM（Java、TypeScript）
- 存储：Node 22 内置 SQLite，一个文件就是整张图
- 接口：官方 MCP SDK，stdio 接入
- 界面：本地 Web，服务 → API / MQ / JOB / 表 / 缓存的树状目录

安装三步：

```bash
npx codeloom-cli analyze https://github.com/you/your-service.git
npx codeloom-cli serve        # http://127.0.0.1:3111
claude mcp add codeloom -- npx -y codeloom-cli mcp
```

代码不出本机；索引存在 `~/.codeloom/graph.db`。

![架构：解析 → 图谱 → MCP / Web](article-assets/fig3.png)

打开界面就是一张服务树，一个服务一棵：API / MQ / JOB / 数据表 / 缓存，右侧直接标出跨服务消费方。

![服务树](article-assets/fig4-service-tree.png)

点任意 API 的「链路」，看跨仓库调用契约（前端页面 → Feign 调用方 → 提供方 → 数据表）。

![跨仓库链路](article-assets/fig5-chain.png)

## 变更影响：测试可以更精准

图谱不只用来「看」。Web 里有一个「变更影响」视图：贴一段 git diff（或选一个本地提交），它会：

1. 定位 diff 里改动的方法
2. 反向追到所有入口：HTTP 接口、页面、MQ 消费方、Job
3. 给出该跑的单测和回归用例，并标出**没有被任何测试覆盖**的改动

对测试同学来说，这意味着不用「全量回归」，而是按影响面挑用例；对开发来说，提交前就能知道这次改动会惊动谁。

![变更影响视图：从 diff 到入口和测试清单](article-assets/fig6-impact.png)

Java 常见写法基本覆盖：`@RestController` / `@Controller`、Feign 接口 + implements 契约、Spring DI 分派、RabbitMQ / Kafka / RocketMQ、`@Scheduled` / `@XxlJob`、MyBatis XML / `@Select` / BaseMapper / 自定义 `BaseMapperX` / `ServiceImpl`、`lambdaQuery`、`@Cacheable` / Redis 键。连「把 Registry 传给分页工具类执行查询」这种委托写法，也能把表归属回调用方。

## 它做不到什么（请一定看）

- **语法级解析**：反射、AOP 代理、动态分派看不见。每条调用边都标了置信度（确定 / 推断 / 推测），Agent 会说明哪一跳不确定
- **外部依赖会断链**：Feign 接口定义在没索引的仓库或 jar 里，链路就停在那里
- **网关前缀要配置**：前后端路径对不上时，在界面「全局配置」里配一次
- **以 Java 为主**，TypeScript 覆盖常用写法；Go、Python 还没做
- 索引是静态快照，代码改了要重新 `analyze`（增量，几千文件通常几秒）

## 适合谁

- 后端是 Java / Spring，服务多、仓库多，Feign / MQ 关系靠人记
- 已经在用 Claude Code / Cursor，但 Agent 经常「看不到全貌」
- 想给新人一个能查「这个接口到底走哪条链路」的工具

如果只有一个单体小项目，或者主要写 Go / Python，现在不用装 —— 单仓库里 grep 已经够用，装了只是多花 token。

---

项目 Apache-2.0 开源，叫 **CodeLoom**。

- GitHub：https://github.com/guoan1tang/codeloom
- npm：`npm i -g codeloom-cli`
- 完整评测方法、数据表和复现命令：`docs/benchmark.md`

如果它帮你省下了一次跨仓库翻代码的时间，欢迎点 Star；用出问题直接提 Issue，我优先修真实项目里踩到的坑。

---

## 发布备注（不发布）

- 配图顺序：fig2 实测数据 → fig3 架构 → fig4 服务树 → fig5 跨仓库链路 → fig6 变更影响（待补）
- **fig6 待你补**：把 Web「变更影响」视图截图保存为 `docs/article-assets/fig6-impact.png`，正文已按这个路径引用
- 数据表已画进 fig2，正文里的 Markdown 表格在公众号里可删，避免重复
- 评论区高频问题预案：
  - 「代码会不会上传？」→ 不会，本地 SQLite，索引在 `~/.codeloom/graph.db`
  - 「支持 Go / Python 吗？」→ 暂不支持，Java 优先，TypeScript 覆盖常用写法
  - 「和 Sourcegraph / GitNexus 有什么区别？」→ 本地零依赖、MCP 原生、面向 Agent 的调用链和影响面，不替代代码搜索
  - 「公司私有 npm 源装不上」→ 加 `--registry=https://registry.npmjs.org/`