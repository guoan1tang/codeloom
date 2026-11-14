# 评测：接了 CodeLoom 前后的 Agent 表现

> 目的不是证明 CodeLoom 更快，而是量清楚它在什么场景下真的有用、什么场景下是净开销。

## 方法

- 同一个 Claude Code CLI（`claude -p`）、同一个模型、同一套问题，唯一变量是「是否接入 codeloom MCP」
- 两条臂都只允许 `Read / Grep / Glob`（codeloom 臂额外允许 9 个 `mcp__codeloom__*`），Bash 一律禁用
- 记录：耗时、token（含缓存读写）、费用、工具调用次数、读文件数、答案是否正确
- codeloom 索引使用默认配置（`tableNameFallback` 关闭）

## 一、单仓库：ruoyi-vue-pro（7,673 个 Java 文件）

### T1 `GET /system/user/page` 的调用链和用到的表

| | 基线（只读代码） | codeloom |
|---|---|---|
| 耗时 | 114.1s | **82.1s（-28%）** |
| 总 token | 259,130 | 235,429（-9%） |
| 费用 | $0.43 | $0.51 |
| 工具调用 | Grep 16 · Glob 1 · Read 3 | MCP 11 · Read 2 |
| 正确性 | ✅ 三张表 | ✅ 三张表，并标出条件分支 |

### T2 修改 `AdminUserServiceImpl.updateUser` 影响哪些接口

| | 基线 | codeloom |
|---|---|---|
| 耗时 | 59.2s | **47.2s（-20%）** |
| 总 token | 70,982 | 85,547（+20%） |
| 读文件 | 1 | **0** |
| 正确性 | ✅ | ✅ |

**单仓库结论**：时间稳定快 20–30%，零源码即可回答；token 没有优势——9 个 MCP 工具的 schema 每个会话要写 15–20k 缓存 token，短会话里这是净开销。

## 二、跨仓库：mall4cloud（order / product 拆成两个仓库）

项目：`gz-yami/mall4cloud`，把 `mall4cloud-order` 与 `mall4cloud-product` 拆成两个独立 git 仓库，
各自带上共享的 `api`、`common` 模块（模拟真实组织的多仓布局）。问题：

> 下单提交时订单服务调用 product 服务锁定库存，product 最终写入哪些数据库表？

正确答案（图谱与源码一致）：`sku_stock`、`spu_extension`、`sku_stock_lock`。

| | 基线（只检出 order） | 基线（两个仓库都检出） | codeloom（只检出 order） |
|---|---|---|---|
| 耗时 | 37.7s | 68.1s | 46.3s |
| 总 token | 105,876 | 164,514 | **89,511** |
| 费用 | $0.13 | $0.21 | $0.16 |
| 读文件 | 2 | 3 | **1** |
| 正确答案 | ❌ 明确回答"不在本仓库，无法给出"（另一次运行凭记忆猜 2 张，漏 `spu_extension`） | ✅ 3 张 | ✅ 3 张，带方法链路 |

**跨仓库结论**：即使把两个仓库都检出，基线也要多花 ~47% 的时间、~84% 的 token 才能得到同样答案；
只检出当前仓库时，基线无法给出可信答案。这正是 codeloom 的核心价值。

## 复现

```bash
# 1. 索引（两个仓库进同一个库）
codeloom analyze path/to/mall4cloud-order  --db /tmp/bench/g.db
codeloom analyze path/to/mall4cloud-product --db /tmp/bench/g.db

# 2. 基线（无 MCP）
claude -p "…" --strict-mcp-config --allowedTools Read Grep Glob --output-format json

# 3. codeloom 臂
claude -p "…" --strict-mcp-config \
  --mcp-config '{"mcpServers":{"codeloom":{"command":"codeloom","args":["mcp"],"env":{"CODELOOM_DB":"/tmp/bench/g.db"}}}}' \
  --allowedTools Read Grep Glob "mcp__codeloom__*" --output-format json
```

## 结论

- 单仓库、代码规范的项目：**省时间，不省 token**
- 多仓库、契约跨服务：**正确性和 token 都明显占优**
- Token 优势来自"不用把另一个仓库读进来"，不是来自工具本身的开销