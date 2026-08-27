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
- **插件系统**：经过审查的集成 package，以及固定到精确版本的 npm/JSR Kalo 插件，都可以增加 Agent 工具、受长度限制的 System Prompt 片段和 schema-driven 设置；专用对话模式还支持 Agent 创建、沙箱测试、审查和分享本地插件草稿。
- **新加坡餐厅营养数据**：通过可审查的静态快照，为麦当劳、赛百味和肯德基提供离线 Agent 查询工具。

## Monorepo 结构

本仓库使用 Bun workspace：

```text
apps/
  web/       SvelteKit PWA
packages/
  plugin-sdk/             稳定插件协议
  plugin-example/         可发布到 npm/JSR 的参考插件
  plugin-mcdonalds-sg/    新加坡麦当劳营养静态数据工具
  plugin-subway-sg/       新加坡赛百味营养静态数据工具
  plugin-kfc-sg/          新加坡肯德基营养与过敏原静态数据工具
  ...                     后续共享与插件 package
```

根目录脚本会代理到 web workspace，因此日常命令保持不变。

## npm / JSR 插件 package

用户可以在**设置 → 插件**中导入固定到精确版本的 Kalo 插件 package，或上传单个自包含的本地 `.js` / `.mjs` 文件：

```text
npm:package@1.2.3
npm:@scope/package@1.2.3
jsr:@scope/package@1.2.3
```

卡卡会拒绝 tag、版本范围、未固定版本和任意 URL。Registry package 会通过 esm.sh 下载一次自包含 bundle 并存入 IndexedDB，后续可离线使用；本地文件最大 2 MiB 且不得包含 import。新安装插件默认停用，可执行缓存源码会包含在完整备份中，从备份恢复后必须再次明确启用。

在空白新对话中选择“插件开发模式”，Agent 可以创建带 revision 的本地草稿，在零权限 sandbox 中检查和测试，并在停用安装前展示源码、hash、权限和 Prompt 供用户明确审查。通过检查且不超过 48 KiB 的草稿可分享为 gzip/base64url URL fragment；打开分享链接不会执行源码。流程和限制见 [`docs/plugin-development.md`](./docs/plugin-development.md)，package 导出契约和安全边界见 [`packages/plugin-sdk/README.md`](./packages/plugin-sdk/README.md)。

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

用户安装的 registry 与本地插件会在采用默认拒绝 CSP 的 opaque-origin iframe Worker 沙箱中执行，无法直接访问 DOM、IndexedDB、浏览器存储或网络；声明的 host services 会强制检查权限，插件存储按 ID 隔离。沙箱不能保证工具语义或 System Prompt 文本可信，因此请只安装你已独立审查并信任的精确代码。Safari 与 iOS WebKit 已完成真机验证，但仍对用户插件 fail-close；详见 [`docs/webkit-plugin-sandbox-validation.md`](./docs/webkit-plugin-sandbox-validation.md)。缓存的可执行源码会包含在完整备份中。

大语言模型可能因知识错误、过时或幻觉给出不准确信息。本项目不提供医疗、营养或其他专业建议。

## 许可证

本项目使用 [MIT License](./LICENSE)。
