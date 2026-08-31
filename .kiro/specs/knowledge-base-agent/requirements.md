# Requirements Document

## Introduction

本 Spec 定义一个从零构建的 AI Agent 应用。该 Agent 的知识不存放在本地自建向量库中，而是托管在第三方知识库平台上，Agent 通过该平台的检索 API 获取知识片段；同时 Agent 作为 MCP（Model Context Protocol）客户端连接一个或多个 MCP Server，通过 MCP 协议发现并调用外部工具，其中必须包含天气查询工具。Agent 由大模型驱动，采用「工具调用循环」的方式自主决定何时检索知识库、何时调用工具，并在最终回复中标注信息来源。

交付范围覆盖：配置与密钥管理、大模型接入、第三方知识库检索、MCP 客户端与工具编排、天气查询、会话管理、命令行与 HTTP 两种交互入口、可观测性、部署与文档。

> 说明：用户原始描述中的「mpc 接口」在本文档中按 MCP（Model Context Protocol）理解。若实际指其他协议，请在评审时指出，本文档将相应调整。

### 待确认的技术假设

以下假设已写入需求，如与实际预期不符请在评审时告知，我会同步修订：

1. **第三方知识库平台**：假设平台提供 HTTP 检索 API，返回带相似度分数与来源元数据的文本片段（兼容 Dify / Coze / 阿里百炼 / RAGFlow / Pinecone 等形态）。具体平台在设计阶段确定。
2. **LLM 供应商**：假设使用支持 OpenAI 兼容 Chat Completions 与 function calling 的服务（如 OpenAI、DeepSeek、通义千问、Moonshot）。
3. **技术栈**：假设 Python 3.11 + 官方 MCP Python SDK；HTTP 服务使用 FastAPI。
4. **交互形态**：同时提供 CLI（本地调试用）与 HTTP API（对外集成用），暂不含前端页面。
5. **天气数据来源**：由 MCP Server 侧对接公开天气 API（如 OpenWeatherMap / 和风天气），Agent 侧只感知 MCP 工具接口。
6. **部署目标**：本地进程运行 + 容器镜像，暂不含云上编排（K8s / Serverless）。
7. **除天气外的工具**：本版本仅要求天气工具，其余工具通过配置新增 MCP Server 即可接入，无需改代码。

## Glossary

- **System**：本 Spec 定义的知识库智能体应用整体。
- **Agent_Core**：智能体核心编排器，接收用户输入，决定调用大模型或工具，产出最终回复。
- **LLM_Gateway**：大模型网关，统一封装对第三方大模型服务的调用与重试。
- **KB_Connector**：知识库连接器，通过第三方知识库平台的 HTTP API 执行检索并返回检索片段。
- **KB_Platform**：第三方知识库平台，负责文档存储、切分、向量化与检索。
- **检索片段**：知识库返回的一条结果，包含文本内容、来源标识、相似度分数。
- **数据集标识**：KB_Platform 中一个知识库数据集的唯一标识，由配置项 `dataset_ids` 声明。
- **来源标识**：标注一条检索片段出处的复合标识，包含数据集标识与文档标识。
- **MCP_Client**：MCP 协议客户端，负责与 MCP Server 握手、发现工具、调用工具。
- **MCP_Server**：遵循 MCP 协议对外暴露工具能力的外部进程或服务。
- **消息对象**：MCP_Client 与 MCP_Server 之间交换的一条 MCP 消息在程序内部的结构化表示，按类别分为请求、响应、通知、错误四类。
- **报文文本**：消息对象按 JSON-RPC 2.0 规范序列化后得到的 UTF-8 编码文本。
- **消息标识**：JSON-RPC 2.0 报文中用于匹配请求与响应的标识，取值为字符串或数值。
- **往返属性**：序列化与解析互为逆操作的性质，即经过一轮「序列化→解析」或「解析→序列化→解析」后得到与起点等价的消息对象。
- **Weather_Tool**：由 MCP_Server 暴露的天气查询工具。
- **候选地点**：地点名称在天气数据源中匹配到多个地理坐标时返回的可选地点条目，包含地点名称、所属一级行政区划名称、国家或地区名称。
- **Tool_Registry**：工具注册表，保存工具唯一标识、描述、入参 JSON Schema。
- **Tool_Turn**：一次「大模型产出工具调用 → 执行同一条助手消息内的全部工具调用 → 结果回填」的编排循环迭代。
- **Session_Manager**：会话管理器，维护单个会话内的消息列表。
- **会话标识**：Session_Manager 为每个会话生成的、在全部未过期会话中互不重复的标识。
- **一轮对话**：一条 `user` 角色消息及其之后到下一条 `user` 角色消息之前的全部 `assistant` 与 `tool` 角色消息。
- **Config_Loader**：配置加载器，从环境变量与配置文件读取并校验配置。
- **CLI_Interface**：命令行交互入口。
- **API_Service**：HTTP 服务入口。
- **Observability_Module**：日志与追踪模块。
- **trace 标识**：单次用户请求在系统内唯一的追踪标识，写入该次请求处理期间产生的全部日志记录。
- **基于属性的测试**：针对大量随机生成的输入验证既定性质是否恒成立的自动化测试方法，失败时输出最小化反例。
- **桩实现**：测试中替代真实依赖、返回预设结果且不发起对外网络请求的替身实现。

## Requirements

### 需求 1：配置与密钥管理

**用户故事：** 作为开发者，我希望通过配置文件与环境变量集中管理模型、知识库、MCP Server 的接入参数，以便在不修改代码的情况下切换环境。

#### 验收标准

1. WHEN 进程启动，THE Config_Loader SHALL 在 2 秒内按「环境变量 → `config.yaml` → 内置默认值」的优先级完成全部配置项加载，对同名配置项以环境变量取值作为最终生效值，并在进程运行期间不再变更已生效取值
2. IF 必填配置项（大模型 API Key、KB_Platform 接入地址、KB_Platform API Key）中任意一项缺失（即环境变量与 `config.yaml` 均未提供该项，或其取值去除首尾空白字符后长度为 0），THEN THE Config_Loader SHALL 终止启动流程、不启动 FastAPI 服务、以非零退出状态结束进程，并一次性输出全部缺失配置项的名称清单（仅名称、不含取值）
3. WHERE `config.yaml` 中声明了 MCP_Server 列表，THE Config_Loader SHALL 解析该列表中最多 20 个条目，并为每个条目解析服务名称（长度 1–64 个字符）、传输方式（取值为 `stdio` 或 `streamable-http`）、以及启动命令（传输方式为 `stdio` 时，长度 1–1024 个字符）或访问 URL（传输方式为 `streamable-http` 时，长度 1–2048 个字符）
4. IF 某个 MCP_Server 条目的传输方式取值不属于 `stdio` 与 `streamable-http`，THEN THE Config_Loader SHALL 终止启动流程、以非零退出状态结束进程，并输出该条目的服务名称与其非法的传输方式取值
5. THE Observability_Module SHALL 在写出日志、控制台输出与错误信息前，将配置项名称（含嵌套层级中任一层名称）以不区分大小写方式包含 `key`、`token` 或 `secret` 子串的字段取值整体替换为固定的 `***`，且不保留原取值长度与任何原字符
6. IF `config.yaml` 不存在、不可读取或不能被解析为合法 YAML 映射结构，THEN THE Config_Loader SHALL 终止启动流程、以非零退出状态结束进程，并输出指示配置文件不可用或格式非法的错误信息（含出错位置的行号，若解析器可提供）
7. IF 某个 MCP_Server 条目缺少其传输方式对应的必填字段（`stdio` 缺少启动命令、`streamable-http` 缺少访问 URL）、服务名称为空，或列表中存在重复的服务名称，THEN THE Config_Loader SHALL 终止启动流程、以非零退出状态结束进程，并输出涉及的条目服务名称及缺失或重复的字段名称
8. WHEN 全部必填配置项校验通过且配置加载完成，THE Observability_Module SHALL 输出一条配置生效摘要，逐项列出配置项名称、其生效来源（环境变量、`config.yaml` 或内置默认值）以及已成功解析的 MCP_Server 条目数量，且其中的敏感字段取值按第 5 条规则掩码

### 需求 2：大模型接入与回复生成

**用户故事：** 作为开发者，我希望 Agent 通过统一网关调用大模型，以便更换供应商时只修改配置。

#### 验收标准

1. WHEN Agent_Core 提交包含 1 至 200 条消息的消息列表，THE LLM_Gateway SHALL 调用配置项 `provider` 与 `model` 指定的大模型 Chat Completions 接口，并在单次请求超时上限 60 秒内返回助手消息，该助手消息包含文本内容与工具调用列表两部分，其中工具调用列表可为空列表
2. THE LLM_Gateway SHALL 在每次请求中携带 Tool_Registry 内全部工具（数量上限 128 个）的唯一标识、描述与入参 JSON Schema
3. IF Tool_Registry 内工具数量为 0，THEN THE LLM_Gateway SHALL 在请求中不携带任何工具定义并继续发起请求
4. IF 大模型接口返回 HTTP 429 或 5xx 状态码，或发生连接失败、单次请求超过 60 秒超时，THEN THE LLM_Gateway SHALL 按指数退避策略重试，首次等待 1 秒、每次等待时长翻倍（依次为 1 秒、2 秒、4 秒）、最多重试 3 次
5. IF 重试 3 次后仍未获得成功响应，THEN THE LLM_Gateway SHALL 返回错误码 `LLM_UNAVAILABLE` 及供应商返回的原始错误描述（截断至最多 500 个字符），且不返回任何部分助手消息，并保持传入的消息列表内容不被修改
6. WHERE 配置项 `streaming` 取值为 true，WHEN 大模型接口开始返回响应，THE LLM_Gateway SHALL 在 10 秒内返回首个增量文本片段，并按生成顺序逐段返回后续片段，最后返回一个流结束标记
7. IF 消息列表的输入 token 数超过配置项 `max_input_tokens`（未显式配置时取默认值 8192，取值范围 512 至 1,000,000），THEN THE LLM_Gateway SHALL 在发起任何网络请求之前返回错误码 `CONTEXT_OVERFLOW`，并在错误描述中给出实际输入 token 数与当前上限值
8. IF 流式响应在返回流结束标记之前中断，THEN THE LLM_Gateway SHALL 返回错误码 `LLM_STREAM_INTERRUPTED`，将已返回的片段标记为不完整，且不自动重发本次请求
9. IF 配置项 `provider`、`model`、访问凭据中任意一项缺失或取值不在允许集合内，THEN THE LLM_Gateway SHALL 拒绝处理后续请求并返回错误码 `LLM_CONFIG_INVALID` 及指明缺失或非法配置项名称的错误描述
10. WHEN 配置项 `provider` 或 `model` 变更并完成配置重载，THE LLM_Gateway SHALL 使用变更后的供应商与模型处理后续请求，且 Agent_Core 提交消息列表与接收助手消息的调用方式保持不变

### 需求 3：第三方知识库检索

**用户故事：** 作为使用者，我希望 Agent 基于托管在第三方平台上的知识库回答问题，并给出出处，以便我核实答案。

#### 验收标准

1. WHEN Agent_Core 以长度为 1 至 1000 个字符的查询文本请求知识检索，THE KB_Connector SHALL 调用 KB_Platform 的检索 API，并在 10 秒内返回检索片段列表（列表长度 0 至 `top_k`）
2. THE KB_Connector SHALL 返回不超过配置项 `top_k` 条检索片段，`top_k` 取值范围为 1 至 20、未配置时取 5，且每条片段均包含文本内容（最长 2000 个字符，超出部分截断）、来源标识、取值范围为 0.0 至 1.0 的相似度分数
3. THE KB_Connector SHALL 剔除相似度分数严格小于配置项 `score_threshold` 的检索片段，`score_threshold` 取值范围为 0.0 至 1.0、未配置时取 0.5
4. WHERE 配置项 `dataset_ids` 包含 2 至 10 个数据集标识，THE KB_Connector SHALL 对每个数据集执行检索，剔除来源标识与文本内容均相同的重复片段，并将合并结果按相似度分数降序排序；分数相同时按 `dataset_ids` 中的先后顺序排列
5. IF KB_Platform 在 10 秒内未返回响应，THEN THE KB_Connector SHALL 中断该请求、不进行重试、不返回任何部分片段，并返回错误码 `KB_TIMEOUT`
6. IF KB_Platform 返回 4xx 状态码，THEN THE KB_Connector SHALL 不进行重试，并返回错误码 `KB_REQUEST_REJECTED` 及平台返回的错误描述
7. IF 检索片段列表为空，THEN THE Agent_Core SHALL 在回复中声明未在知识库中检索到相关内容，且不输出任何来源标识
8. WHEN 回复内容引用了检索片段，THE Agent_Core SHALL 在回复中列出每个被引用片段的来源标识（包含数据集标识与文档标识），相同来源标识只列出一次，且列出条数不超过 `top_k`
9. IF KB_Platform 返回 5xx 状态码或网络不可达，THEN THE KB_Connector SHALL 最多重试 2 次、每次重试间隔 1 秒，重试仍失败时返回错误码 `KB_UNAVAILABLE`
10. IF 多数据集检索中部分数据集检索失败，THEN THE KB_Connector SHALL 返回检索成功数据集的合并结果并标注失败的数据集标识
11. IF 全部数据集检索失败，THEN THE KB_Connector SHALL 返回错误码 `KB_UNAVAILABLE`
12. IF 查询文本为空、仅包含空白字符或长度超过 1000 个字符，THEN THE KB_Connector SHALL 不调用 KB_Platform，并返回错误码 `KB_INVALID_QUERY` 及指明长度约束的错误描述

### 需求 4：MCP 客户端与工具发现

**用户故事：** 作为开发者，我希望 Agent 通过 MCP 协议连接外部工具服务，以便新增能力时只需增加 MCP Server 配置。

#### 验收标准

1. WHEN 进程启动，THE MCP_Client SHALL 对配置中的每个 MCP_Server 建立连接并在配置项 `mcp_connect_timeout_seconds`（取值范围 1 至 60，默认取值 10）内完成 MCP initialize 握手
2. WHEN 握手完成，THE MCP_Client SHALL 调用 `tools/list` 获取工具清单，并将每个工具的唯一标识、描述、入参 JSON Schema 写入 Tool_Registry，单个 MCP_Server 写入的工具数量不超过配置项 `max_tools_per_server`（默认取值 64）
3. THE MCP_Client SHALL 以 `{服务名称}__{工具名称}` 格式为 Tool_Registry 中每个工具生成唯一标识，且标识长度不超过 128 个字符
4. IF 某个 MCP_Server 的连接、握手或 `tools/list` 调用失败或超时，THEN THE MCP_Client SHALL 记录该服务名称与失败原因、将该服务状态标记为不可用、跳过该服务的工具注册，并继续加载其余 MCP_Server 且不终止启动流程
5. WHEN Agent_Core 请求执行工具，THE MCP_Client SHALL 按 Tool_Registry 中该工具的入参 JSON Schema 校验入参，当全部必填字段存在、且每个字段的取值类型与取值范围符合 Schema 声明时判定校验通过
6. IF 入参校验未通过，THEN THE MCP_Client SHALL 返回错误码 `INVALID_TOOL_ARGS` 及未通过校验的字段名称列表，且不发起 `tools/call` 调用
7. WHEN 入参校验通过，THE MCP_Client SHALL 调用 `tools/call` 并返回该工具的结果内容，结果文本长度上限为配置项 `max_tool_result_chars`（默认取值 8000），超出上限的部分被截断且结果中附带截断标记
8. IF 工具调用在配置项 `tool_timeout_seconds`（取值范围 1 至 300，默认取值 30）内未返回结果，THEN THE MCP_Client SHALL 取消该调用、释放该次调用占用的连接资源，并返回错误码 `TOOL_TIMEOUT`
9. IF Agent_Core 请求的工具唯一标识在 Tool_Registry 中不存在，THEN THE MCP_Client SHALL 返回错误码 `TOOL_NOT_FOUND`，且不发起任何 MCP 请求
10. IF 待调用工具所属 MCP_Server 的连接已断开，THEN THE MCP_Client SHALL 在 `mcp_connect_timeout_seconds` 内尝试重新连接并握手 1 次；重连失败时返回错误码 `TOOL_UNAVAILABLE` 及该服务名称
11. IF 新生成的工具唯一标识与 Tool_Registry 中已存在的标识重复，THEN THE MCP_Client SHALL 保留先注册的工具、不注册后加载的工具，并记录冲突的唯一标识与两个来源服务名称

### 需求 5：MCP 消息的序列化与解析

**用户故事：** 作为开发者，我希望 MCP 报文的序列化与解析可独立验证，以便快速定位协议层问题。

#### 验收标准

1. WHEN Agent_Core 请求向 MCP_Server 发送请求对象，THE MCP_Client SHALL 将该对象序列化为符合 JSON-RPC 2.0 规范的报文文本，且报文文本包含协议版本标识 `2.0`、消息标识、方法名与入参结构，并以 UTF-8 编码输出
2. WHEN 收到 MCP_Server 的报文文本，THE MCP_Client SHALL 按以下判定规则将其解析为四类消息对象之一：包含方法名且包含消息标识者判定为请求；包含方法名且不含消息标识者判定为通知；包含消息标识与执行结果者判定为响应；包含消息标识与错误结构者判定为错误
3. IF 报文文本不符合 JSON-RPC 2.0 规范（协议版本标识取值不为 `2.0`、文本不是合法 JSON、四类判定规则均不匹配、同时包含执行结果与错误结构、或字节长度超过 1,048,576 字节），THEN THE MCP_Client SHALL 返回错误码 `MALFORMED_MESSAGE`，在错误中保留原始报文文本的前 4,096 个字符并标注是否发生截断，且保持与该 MCP_Server 的连接可继续收发后续报文
4. IF 请求对象无法序列化（存在取值不属于 JSON 可表示类型的字段、嵌套层数超过 32 层、或序列化结果字节长度超过 1,048,576 字节），THEN THE MCP_Client SHALL 返回错误码 `SERIALIZATION_FAILED` 及触发失败的字段名称，且不向 MCP_Server 发送任何报文
5. THE MCP_Client SHALL 判定两个消息对象等价当且仅当：消息类别相同、消息标识的取值与类型（字符串或数值）相同、方法名相同、全部字段的取值逐层相同、原本不存在的可选字段在两侧均不存在且不被替换为空值、字符串内容的 Unicode 码点序列相同；报文文本中键的排列顺序与空白字符不影响等价判定
6. FOR ALL 合法消息对象（四类消息各自覆盖，嵌套层数 1 至 32 层，字符串字段长度 0 至 1,024 字符，消息标识为长度 1 至 128 的字符串或数值），序列化后再解析 SHALL 得到与原消息对象按验收标准 5 判定等价的消息对象（往返属性）
7. FOR ALL 合法 JSON-RPC 2.0 报文文本（字节长度 1 至 1,048,576 字节，含键顺序与空白字符的任意排列），解析后再序列化再解析 SHALL 得到与首次解析结果按验收标准 5 判定等价的消息对象（往返属性）
8. WHEN 报文文本包含 JSON-RPC 2.0 规范之外的额外字段，THE MCP_Client SHALL 在解析结果中原样保留这些字段的名称与取值，并在再次序列化时原样输出，使验收标准 7 的往返属性成立

### 需求 6：天气查询

**用户故事：** 作为使用者，我希望向 Agent 提问天气时得到指定地点的实时天气与预报，以便安排行程。

#### 验收标准

1. WHEN 用户输入同时包含地点名称与天气相关意图（当前天气或未来若干日天气），THE Agent_Core SHALL 生成一次对 Weather_Tool 的调用，且入参的地点名称字段取值取自用户输入中的地点名称、长度为 1 至 64 个字符
2. THE Weather_Tool SHALL 返回指定地点的温度（摄氏度，保留 1 位小数）、天气状况描述（非空文本）、相对湿度（0 至 100 的整数百分比）、风速（米每秒，保留 1 位小数）、数据观测时间（采用该地点当地时区、带时区偏移的 ISO 8601 时间戳）
3. WHERE 入参包含取值为 1 至 7 的整数预报天数，THE Weather_Tool SHALL 返回条数与该天数相等的逐日预报，每日包含日期、最高温度、最低温度（均为摄氏度，保留 1 位小数）与天气状况描述
4. WHERE 入参未包含预报天数，THE Weather_Tool SHALL 按预报天数取值 3 处理
5. IF 地点名称在天气数据源中匹配到多个地理坐标，THEN THE Weather_Tool SHALL 返回不超过 5 条候选地点、每条包含地点名称、所属一级行政区划名称、国家或地区名称且不返回天气数据，且 THE Agent_Core SHALL 在回复中列出全部候选地点并请用户确认其中一个地点
6. IF 天气数据源返回错误响应，或在 10 秒内未返回响应，THEN THE Weather_Tool SHALL 中断该请求并返回错误码 `WEATHER_SOURCE_ERROR` 及数据源返回的状态码（超时情形下返回超时说明）
7. WHEN 最终回复内容包含天气数据，THE Agent_Core SHALL 在回复中标注天气数据来源名称与数据观测时间（含时区偏移）
8. IF 用户输入包含天气相关意图但未包含地点名称，且当前会话消息列表中不存在此前已确认的地点名称，THEN THE Agent_Core SHALL 不调用 Weather_Tool 并在回复中请用户提供地点名称
9. IF 入参中的预报天数取值不是 1 至 7 的整数，THEN THE MCP_Client SHALL 拒绝该调用、不向 Weather_Tool 转发，并返回错误码 `INVALID_TOOL_ARGS` 及未通过校验的字段名称
10. IF 地点名称在天气数据源中无任何匹配地理坐标，THEN THE Weather_Tool SHALL 返回错误码 `LOCATION_NOT_FOUND` 及该地点名称，且 THE Agent_Core SHALL 在回复中声明未能识别该地点并请用户提供更完整的地点名称

### 需求 7：工具编排循环

**用户故事：** 作为使用者，我希望 Agent 自主判断是否检索知识库或调用工具，并在多步推理后给出完整回答。

#### 验收标准

1. WHEN 进程启动且 MCP_Client 完成工具发现，THE Agent_Core SHALL 将知识库检索能力以工具形式注册进 Tool_Registry，唯一标识为 `knowledge_base__search`，其入参 JSON Schema 包含必填字段 query（字符串，长度 1 到 1000 个字符）与可选字段 top_k（整数，取值 1 到 20）
2. WHEN 大模型返回的助手消息包含工具调用，THE Agent_Core SHALL 执行其中每个工具调用，将每条执行结果以携带对应调用标识的 tool 角色消息追加到消息列表末尾，并在全部工具调用结果均已回填后再次调用 LLM_Gateway
3. WHEN 大模型在同一条助手消息中返回 2 个及以上工具调用，THE Agent_Core SHALL 并发执行这些工具调用并按调用标识对应回填结果，同时并发执行的调用数量不超过配置项 `max_parallel_tool_calls`（默认取值 5），超出该数量的调用排队等待
4. THE Agent_Core SHALL 将单次用户请求内的 Tool_Turn 次数限制为配置项 `max_tool_turns`（取值范围 1 到 20，默认取值 5），且将「执行同一条助手消息内的全部工具调用并完成结果回填」计为 1 次 Tool_Turn
5. WHEN 已完成的 Tool_Turn 次数达到 `max_tool_turns`，THE Agent_Core SHALL 停止执行后续工具调用、基于消息列表中已回填的工具结果调用 LLM_Gateway 一次生成最终回复，并在最终回复中声明因达到工具调用轮次上限而中止工具调用
6. IF 达到 `max_tool_turns` 后调用 LLM_Gateway 返回的助手消息仍包含工具调用，THEN THE Agent_Core SHALL 不执行这些工具调用并将该消息的文本内容作为最终回复
7. IF 工具执行返回错误码，THEN THE Agent_Core SHALL 将该错误码与错误描述以携带对应调用标识的 tool 角色消息回填到消息列表，将该次迭代计入 Tool_Turn 次数，并在 Tool_Turn 次数未达到 `max_tool_turns` 时继续编排循环
8. WHEN 大模型返回的助手消息不包含工具调用且其文本内容长度大于 0 个字符，THE Agent_Core SHALL 将该消息的文本内容作为最终回复返回并结束本次编排循环
9. IF 同一工具唯一标识在单次用户请求内连续 3 次返回错误码，THEN THE Agent_Core SHALL 不再执行该工具唯一标识的后续调用，并在最终回复中声明该工具不可用及最近一次的错误描述
10. IF 单次用户请求的编排循环累计耗时超过配置项 `max_orchestration_seconds`（默认取值 120），THEN THE Agent_Core SHALL 取消尚未返回结果的工具调用，并基于消息列表中已回填的工具结果生成最终回复，且在最终回复中声明因超时而中止工具调用
11. IF 大模型返回的助手消息不包含工具调用且其文本内容长度为 0 个字符，THEN THE Agent_Core SHALL 返回错误码 `EMPTY_FINAL_RESPONSE` 并保留本次会话的消息列表不做回滚

### 需求 8：会话与上下文管理

**用户故事：** 作为使用者，我希望 Agent 记住同一会话中的历史对话，以便进行多轮追问。

#### 验收标准

1. THE Session_Manager SHALL 为每个会话维护按追加时间升序排列的消息列表，且每条消息包含角色（取值为 `system`、`user`、`assistant`、`tool` 之一）、消息内容、追加时间戳
2. WHEN 调用方发起新会话，THE Session_Manager SHALL 生成一个在全部未过期会话中互不重复的会话标识，将该会话消息列表初始化为仅含一条 `system` 角色消息，并在同一次响应中将该会话标识返回给调用方
3. WHEN 会话消息列表的累计 token 数超过配置项 `max_history_tokens`（默认取值 8000），THE Session_Manager SHALL 保留 `system` 角色消息与最近 `keep_recent_turns`（默认取值 3）轮对话，并移除更早的消息；一轮对话指一条 `user` 角色消息及其之后到下一条 `user` 角色消息之前的全部 `assistant` 与 `tool` 角色消息
4. WHERE 配置项 `session_store`（默认取值 `memory`）取值为 `redis` 或 `sqlite`，THE Session_Manager SHALL 在每次追加或移除消息后、返回本次响应前，以会话标识为键将该会话的完整消息列表写入该存储后端
5. IF 请求携带的会话标识在 Session_Manager 中不存在或已过期，THEN THE API_Service SHALL 返回 HTTP 404 状态码与错误码 `SESSION_NOT_FOUND`，且不创建新会话、不调用 Agent_Core
6. IF 按 `keep_recent_turns` 裁剪后累计 token 数仍超过 `max_history_tokens`，THEN THE Session_Manager SHALL 自最早的非 `system` 角色消息起继续逐条移除消息，直至累计 token 数不超过 `max_history_tokens`
7. IF 配置的 `session_store` 后端在 5 秒内未完成写入或连接失败，THEN THE Session_Manager SHALL 返回错误码 `SESSION_STORE_UNAVAILABLE` 及后端返回的错误描述，并保留进程内存中的当前会话消息列表以支持本次请求继续处理
8. WHEN 某会话最近一次消息追加时间距当前时间超过配置项 `session_ttl_seconds`（默认取值 3600），THE Session_Manager SHALL 将该会话标记为已过期并移除其消息列表

### 需求 9：交互入口

**用户故事：** 作为开发者，我希望既能在终端调试 Agent，也能通过 HTTP 接口把 Agent 集成进其他系统。

#### 验收标准

1. WHEN 用户在终端提交一行长度为 1 至 4000 个字符的问题文本，THE CLI_Interface SHALL 在终端显示 Agent 回复文本，并在显示完成后等待下一轮输入
2. WHEN Agent_Core 执行工具调用，THE CLI_Interface SHALL 显示被调用工具的唯一标识、入参内容与执行结果状态，且将入参中名称包含 `key`、`token`、`secret` 的字段取值显示为 `***`
3. THE API_Service SHALL 提供 `POST /chat` 接口，接收会话标识与长度为 1 至 4000 个字符的用户消息，返回助手回复文本与被引用来源标识列表
4. THE API_Service SHALL 提供 `GET /healthz` 接口，返回每个 MCP_Server 与 KB_Platform 的连通状态，状态取值为 `up` 或 `down`，且对单个依赖的探测等待时长不超过 3 秒，探测超时的依赖状态记为 `down`
5. THE API_Service SHALL 对除 `GET /healthz` 以外的全部接口校验请求头 `X-API-Key` 的取值是否与配置项 `service_api_keys` 中的任一取值一致，且仅在校验通过后将请求转交 Agent_Core
6. IF 请求缺失 `X-API-Key` 请求头或其取值不在 `service_api_keys` 中，THEN THE API_Service SHALL 返回 HTTP 401 状态码与错误码 `UNAUTHORIZED`，不将请求转交 Agent_Core，且响应内容不包含 `service_api_keys` 的任何取值
7. WHERE 请求体中 `stream` 取值为 true，WHEN Agent_Core 产出增量文本，THE API_Service SHALL 以 Server-Sent Events 逐段返回该增量文本，并在最终回复结束后发送一个包含被引用来源标识列表的结束事件
8. IF 单个 API Key 在 60 秒内的请求次数超过配置项 `rate_limit_per_minute`（默认取值 60），THEN THE API_Service SHALL 返回 HTTP 429 状态码与错误码 `RATE_LIMIT_EXCEEDED` 及距当前 60 秒计数窗口结束的剩余秒数，且不将该请求转交 Agent_Core
9. IF `POST /chat` 请求的用户消息缺失、仅包含空白字符或长度超过 4000 个字符，THEN THE API_Service SHALL 返回 HTTP 400 状态码与错误码 `INVALID_REQUEST` 及未通过校验的字段名称，且不将请求转交 Agent_Core
10. WHERE `POST /chat` 请求体未携带会话标识，THE API_Service SHALL 通过 Session_Manager 创建新会话，并在响应中返回该新会话标识
11. IF Agent_Core 在 Server-Sent Events 流开始发送后返回错误码，THEN THE API_Service SHALL 发送一个包含该错误码的错误事件并结束该流，且不将该次未完成的助手回复写入会话消息列表

### 需求 10：可观测性

**用户故事：** 作为运维人员，我希望能查看每次请求的模型调用与工具调用明细，以便排查问题与核算成本。

#### 验收标准

1. WHEN LLM_Gateway 完成一次大模型调用，THE Observability_Module SHALL 输出一条 JSON 结构的日志记录，字段包含 trace 标识、模型名称、输入 token 数、输出 token 数、耗时毫秒数、调用结果状态（取值为 `success` 或 `error`）
2. WHEN MCP_Client 完成一次工具调用，THE Observability_Module SHALL 输出一条 JSON 结构的日志记录，字段包含 trace 标识、工具唯一标识、耗时毫秒数、执行结果状态（取值为 `success`、`error` 或 `timeout`），且在执行结果状态不为 `success` 时包含该次调用返回的错误码
3. WHEN CLI_Interface 或 API_Service 接收到一次用户请求，THE Observability_Module SHALL 生成一个在系统内唯一的 trace 标识，并将该标识写入该次请求处理期间产生的全部日志记录
4. WHERE 配置项 `trace_exporter_endpoint` 已设置，WHEN 一次用户请求处理结束，THE Observability_Module SHALL 在 5 秒超时限制内将该次请求的追踪数据发送至该端点
5. IF 追踪数据发送失败或在 5 秒内未收到响应，THEN THE Observability_Module SHALL 输出一条包含 trace 标识与失败原因的日志记录、丢弃该批追踪数据，且不改变用户请求的回复内容与返回时机
6. WHEN 一次用户请求处理结束，THE Observability_Module SHALL 输出一条汇总日志记录，字段包含 trace 标识、会话标识、累计输入 token 数、累计输出 token 数、大模型调用次数、工具调用次数、Tool_Turn 次数、请求总耗时毫秒数
7. IF 大模型调用未获得成功响应，THEN THE Observability_Module SHALL 在该次调用的日志记录中写入错误码与实际重试次数，且将无法从供应商响应中获取的 token 数字段取值记为 0

### 需求 11：部署与项目可运行性

**用户故事：** 作为新加入的开发者，我希望按文档执行少量命令就能在本地跑通 Agent，以便快速上手。

#### 验收标准

1. THE System SHALL 提供依赖声明文件，该文件声明所需的 Python 版本为 3.11 且为每个运行依赖声明固定版本号，使开发者在仅安装 Python 3.11 的纯净环境中执行单条安装命令后该命令返回成功退出码
2. THE System SHALL 提供 `.env.example` 文件，为每个环境变量列出名称、必填或可选标识、用途说明、占位示例取值，且覆盖需求 1 中的全部必填配置项（大模型 API Key、KB_Platform 接入地址、KB_Platform API Key）
3. THE System SHALL 在 `.env.example` 中将全部密钥类环境变量的取值写为占位符文本，不包含任何可用于真实调用的密钥取值
4. THE System SHALL 提供容器镜像构建文件，使镜像构建命令返回成功退出码，且容器启动后 60 秒内 API_Service 的 `GET /healthz` 接口返回成功响应
5. THE System SHALL 提供 README 文档，包含本地启动步骤、全部配置项名称与取值说明、新增 MCP_Server 的 `config.yaml` 配置示例、容器构建与运行命令，且本地启动步骤所含命令条数不超过 5 条
6. WHEN 开发者在仅安装 Python 3.11 的纯净环境中按 README 的本地启动步骤依序执行全部命令并按 `.env.example` 填写全部必填环境变量，THE System SHALL 启动 API_Service，且 `GET /healthz` 接口返回成功响应并显示每个 MCP_Server 与 KB_Platform 的连通状态
7. IF 启动时任一必填环境变量缺失，THEN THE System SHALL 终止启动、输出缺失的环境变量名称清单，并以非零退出码结束进程或容器
8. WHEN 开发者按 README 的配置示例在 `config.yaml` 中新增一个 MCP_Server 条目并重启进程，THE System SHALL 在未修改任何源代码文件的前提下将该 MCP_Server 暴露的工具写入 Tool_Registry

### 需求 12：测试与验证

**用户故事：** 作为开发者，我希望核心逻辑具备自动化测试，以便在改动后确认行为未退化。

#### 验收标准

1. THE System SHALL 为 MCP 消息的序列化与解析提供基于属性的测试，覆盖需求 5 的两条往返属性（序列化→解析等价、解析→序列化→解析等价），每条属性针对不少于 100 组随机生成的输入执行，且生成器覆盖请求、响应、通知、错误四类消息对象、参数嵌套深度 1 至 5 层、字符串长度 0 至 200 字符、含非 ASCII 字符与空对象取值
2. THE System SHALL 为 Session_Manager 的历史裁剪逻辑提供基于属性的测试，针对不少于 100 组随机生成的输入执行，输入空间覆盖消息列表长度 1 至 200 条、单条消息 token 数 1 至 2000、`max_history_tokens` 取值 100 至 100000，并验证三条属性：裁剪后系统提示仍位于消息列表首位、裁剪后累计 token 数不超过 `max_history_tokens`、保留消息之间的时间先后顺序与裁剪前一致
3. THE System SHALL 为 Agent_Core 的编排循环提供测试，使用桩实现替代 LLM_Gateway、KB_Connector、MCP_Client 且测试过程中不发起对外网络请求，覆盖五类场景：助手消息不含工具调用、含 1 个工具调用、同一条助手消息含 2 个及以上工具调用、工具返回错误码、Tool_Turn 次数达到 `max_tool_turns`，并对每类场景断言最终回复内容与 LLM_Gateway 被调用次数
4. THE System SHALL 为 KB_Connector 与 Weather_Tool 分别提供集成测试，每项使用 1 至 3 个代表性用例，KB_Connector 用例覆盖返回非空检索片段与返回空片段列表两种结果，Weather_Tool 用例覆盖实时天气与 1 至 7 日预报两种结果，且每个用例在 30 秒内完成并断言返回结果包含需求 3 与需求 6 规定的全部字段
5. THE System SHALL 为 Tool_Registry 入参校验提供测试，覆盖合法入参、缺失必填字段、字段类型与 JSON Schema 声明不一致三类输入，并断言不合法输入返回错误码 `INVALID_TOOL_ARGS` 及未通过校验的字段名称列表
6. WHEN 开发者执行单条测试命令，THE System SHALL 运行全部自动化测试并输出每项测试的名称与通过或失败结论
7. IF 基于属性的测试发现反例，THEN THE System SHALL 输出被违反的属性名称与最小化后的反例输入数据
8. IF 集成测试依赖的 KB_Platform 或 MCP_Server 在 10 秒内无法连通，THEN THE System SHALL 将该集成测试标记为跳过并输出跳过原因，且不将其计入失败测试数量
