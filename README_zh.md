# Kalo AI（卡卡 AI）

[English](./README.md) | **简体中文**

**一个 agent-native、本地优先的智能减脂陪伴应用。**

用户可以用自然语言表达需求，Kalo 会调用工具协助完成饮食、运动、体重和目标的查询、记录、修改与删除，并结合个人数据提供持续陪伴。

## 核心特点

- **Agent-native**：Agent 能理解自然语言意图，并通过工具协助用户操作数据。
- **本地优先**：健康数据和 API Key 保存在浏览器 IndexedDB 中。
- **零业务后端**：App 完全在前端运行，AI 请求由浏览器直达用户配置的模型服务。
- **BYO Model**：支持 OpenAI Completions、OpenAI Responses 与 Anthropic Messages 协议。
- **完整追踪**：饮食、运动、体重、目标、每日概览与趋势分析。
- **可安装 PWA**：静态部署，支持离线打开应用壳和本地数据。
- **中英双语**：支持简体中文与 English。
- **编译期插件**：经过审查的 workspace package 可以增加 Agent 工具、受长度限制的 System Prompt 片段和 schema-driven 设置。
- **新加坡餐厅营养数据**：通过可审查的静态快照，为麦当劳、赛百味和肯德基提供离线 Agent 查询工具。

## Monorepo 结构

本仓库使用 Bun workspace：

```text
apps/
  web/       SvelteKit PWA
packages/
  plugin-sdk/             稳定插件协议
  plugin-example/         默认停用的集成示例
  plugin-mcdonalds-sg/    新加坡麦当劳营养静态数据工具
  plugin-subway-sg/       新加坡赛百味营养静态数据工具
  plugin-kfc-sg/          新加坡肯德基营养与过敏原静态数据工具
  ...                     后续共享与插件 package
```

根目录脚本会代理到 web workspace，因此日常命令保持不变。

## 开发

```sh
bun install
bun run dev
```

检查、测试、格式化与构建：

```sh
bun run check
bun test
bun run fmt
bun run build
```

也可以直接运行 web package：

```sh
bun run --filter @kalo-ai/web dev
```

## 部署

Web package 使用 SvelteKit adapter-static，构建产物位于 `apps/web/build/`。

根目录的 `wrangler.jsonc` 会部署该目录并提供 SPA fallback。请从仓库根目录部署到 Cloudflare：

```sh
bun run deploy
```

## 隐私与免责声明

App 没有业务后端。健康数据及 API Key 仅保存在当前浏览器；AI 请求直接发送到用户配置的服务。API Key 在 IndexedDB 中明文保存，完整备份也会包含密钥。

大语言模型可能因知识错误、过时或幻觉给出不准确信息。本项目不提供医疗、营养或其他专业建议。

## 许可证

本项目使用 [MIT License](./LICENSE)。
