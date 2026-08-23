# Kalo AI（卡卡 AI）实施蓝图

> 从头重写 CalorieAI 的全新方案。原项目（CalorieAI）代码不保留，仅在概念层面继承"AI + 卡路里追踪"的定位。

## 一、项目定位

**Kalo AI（卡卡 AI）** —— 一个 agent-native 的智能减脂陪伴应用。

- **卡卡**是你的私人减脂教练，以对话为主要交互方式。
- 用户通过和卡卡聊天完成绝大部分操作：记录饮食/运动/体重、设定目标、查询进度、获取建议。
- 辅以两个传统页面：**首页**（看进度 + 接收主动消息）、**设置页**（结构化配置 + 食物库管理）。
- 所有数据本地存储，隐私优先；可安装为 PWA 离线使用。

**与上一版的核心区别**：上一版是"用户填表 + AI 只做食物估算"，卡卡 AI 是"用户说话 + agent 调用工具包办操作"。Agent 不是被动工具，而是交互主体。

## 二、核心设计理念

> **Tap 负责结构化、高频、确定的事；Chat 负责模糊、多步、探索性的事。**
> **Agent-native 的本质是 agent 主动干活 + 在需要时出现，而不是"万物皆对话框"。**

- **不在聊天里做**：填基础信息（首次引导）、管理食物库、改 AI 配置、导出数据。
- **在聊天里做**：记录饮食/运动/体重、设定目标（协商式）、问建议、要解释、查趋势、批量操作。
- **Agent 的四种存在方式**：后台自动（沉淀食物库/算自适应 TDEE）→ 主动推送（饭点/睡前/周报）→ 内嵌上下文对话 → 纯聊天主战场。

## 三、整体架构

### 底部导航：3 槽，中间凸起

```
┌──────────┬──────────┬──────────┐
│   首页   │   (AI)   │   设置   │
└──────────┴─────▲────┴──────────┘
                凸起按钮，进入纯 Agent 聊天页
```

- **首页 Dashboard**：只读状态展示 + Agent 主动消息入口。
- **AI 页**：主战场，多 session 聊天。
- **设置页**：基础信息/目标/AI 配置/食物库管理/数据管理。

首次打开或缺少必要配置 → **强制进入专用 onboarding 流程**，依次完成基础资料与 AI 连接。之后所有交互默认在 AI 页。

## 四、数据模型

沿用 IndexedDB（Dexie.js）。保留原有核心表，并持久化 session 历史与跨会话用户记忆。

### 现有表（保留，字段微调）

```typescript
User {
  id, age, gender, height, currentWeight, targetWeight?, targetDate?,
  activityLevel, bmrMethod?, bodyFatPercentage?, calculatedBMR,
  adaptiveTDEE?, adaptiveConfidence?,
  createdAt, updatedAt
}

FoodEntry   { id, date, time, name, calories, protein, carbs, fat, tef,
              source: 'ai'|'library'|'manual', createdAt }
ExerciseEntry { id, date, time, description, category?, intensity?, duration,
                caloriesBurned, source: 'manual'|'third_party',
                plannedWorkoutId?, createdAt }
WeightEntry { id, date, weight, createdAt }
AIConfig    { id, apiKey, model, updatedAt }
```

### 新增表

```typescript
FoodLibraryItem {
  id, name, category: 'meal'|'snack'|'drink'|'fruit'|'other',
  calories, protein?, carbs?, fat?, servingsCount,
  lastUsedAt, createdAt, updatedAt
}
// source 字段从 FoodEntry 移除原 description，统一用 name
// 食物库条目由 agent 自动沉淀 + 用户手动管理

TrainingPlan {
  id, title, goal?, startDate, endDate?,
  status: 'active'|'paused'|'completed'|'archived',
  createdAt, updatedAt
}

PlannedWorkout {
  id, planId, date, time?, category, description, intensity,
  plannedDuration, estimatedCalories?, notes?,
  status: 'planned'|'completed'|'skipped', exerciseEntryId?,
  createdAt, updatedAt
}

UserMemory {
  id: 'user-memory',
  content: string,    // freeform Markdown，最多 8,000 字符
  version: number,    // 永远递增，清空也创建新版本
  updatedAt
}

Session {
  id, title,          // title 由 agent 根据首条消息自动生成
  createdAt, updatedAt,
  lastMessageAt,
  memoryVersion?      // 此 session 最近成功读取/写入的记忆版本
}

Message {
  id, sessionId,
  order: number,      // 会话内自增序号，用于排序
  role: 'user'|'assistant'|'tool_call'|'tool_result',
  content,            // 文本内容
  toolCalls?: Array<{ id, name, args }>,   // role=tool_call 时
  toolResults?: Array<{ callId, result }>, // role=tool_result 时
  cards?: Card[],     // 结构化卡片（食物记录卡/目标方案卡/趋势图卡）
  createdAt
}
```

### Card 类型（嵌入消息气泡）

```typescript
type Card =
  | { kind: 'food_logged', entry: FoodEntry }
  | { kind: 'exercise_logged', entry: ExerciseEntry }
  | { kind: 'weight_logged', entry: WeightEntry }
  | { kind: 'goal_plan', weeklyRate, dailyDeficit, safe, warning? }
  | { kind: 'trend', type: 'weight'|'calorie'|'exercise', data }
  | { kind: 'summary', date, intake, burned, balance, macros }
```

## 五、Agent 工具面

**设计原则：读少而全（每个返回丰富信息），写各司其职。**

### 读取类

```typescript
getProfile()
// 返回：基础信息 + bmrMethod/bodyFatPercentage + calculatedBMR
//       + Formula/Adaptive/Effective TDEE + adaptiveConfidence
//       + 当前目标 + 目标进度 + 健康体重推荐区间(BMI 18.5-23.9)
//       + 若目标设定则附每周减重/每日缺口/安全提示
// 一个工具一次性给 agent 全部用户画像。

getTodayLog(date?: string)  // 默认今天
// 返回：当日所有 FoodEntry/ExerciseEntry/WeightEntry
//       + 汇总(总摄入/总消耗/净热量/三大营养素/TEF)
//       + 对照 TDEE 的余额

getTrends(range: '7d'|'30d'|'90d')
// 返回：指定范围的体重/摄入/运动时间序列
//       + 自动检测的洞察(平台期/摄入异常/目标预测/趋势方向)
// 一个工具同时给数据 + 分析结论。

getTrainingPlan()
// 返回当前计划、具体训练、今日/逾期/即将开始安排和完成进度。
// 计划数据不会作为已完成运动进入统计。

listLibrary()
// 返回：食物库全部条目（按使用频率/最近使用排序）
// 食物库预期不大，无需分页/搜索参数。

readUserMemory()
// 返回跨 session 的 Markdown 用户记忆、version 与 updatedAt。
// 每条真实 user 消息保存后，若全局 version 与 Session.memoryVersion 不同，
// 应用会在首次模型请求前自动追加这组 tool call/result。
```

### 写入类

```typescript
logFood({ name, calories, protein, carbs, fat, time?, date? })
// 主对话模型在推理时直接估算数值（不再走独立 /analyze 接口）。
// 写入 FoodEntry（source='ai'）。
// 副作用：自动 upsert FoodLibraryItem（按 name 去重，累加 servingsCount，
//         更新 lastUsedAt；若库中已有则比对营养值，差异大则保留库中原值）。
// 返回：写入的 entry + 是否新增/更新了库条目。

logExercise({ replaceEntryId?, category?, intensity?, description,
              duration, caloriesBurned, time?, date? })
// 新增或按准确 id 修正已完成运动；禁止未来日期，返回 entry + corrected。
// 消耗值是参考估算，不直接加回每日饮食预算。

createTrainingPlan({ title, goal?, startDate, endDate?, workouts })
addPlannedWorkout({ planId, workout })
updatePlannedWorkout({ id, expectedDescription, fields })
completePlannedWorkout({ id, actualDate?, actualTime?, actualDuration, caloriesBurned })
linkExerciseToPlannedWorkout({ action, exerciseEntryId, plannedWorkoutId?, expected labels })
setTrainingPlanStatus({ id, status: 'active'|'paused' })
archiveTrainingPlan({ id, expectedTitle })
// 批量创建前必须先展示草案并获得用户明确确认。
// 完成计划项时原子创建并双向关联 ExerciseEntry，重复调用保持幂等。
// 任意已有 ExerciseEntry 也可显式关联、改关联或保持不关联；禁止按名称自动匹配。
// 归档保留已完成运动；计划安排本身不影响 TDEE 或饮食预算。

logWeight({ weight, date? })
// 写入 WeightEntry。触发自适应 TDEE 重算。
// 自适应估算使用最近 14 天（至少 12 天实际跨度）、至少 5 次称重与 ≥85% 饮食覆盖；
// 体重趋势采用 Theil–Sen 中位斜率，避免首尾单次水分波动放大结果。
// 经验值相对公式 TDEE 做合理边界，并按置信度渐进混合，不能低置信度直接替代公式值。
// 返回：entry + 重算后的 adaptiveTDEE（若有变化）。

updateProfile({ fields })
// fields 可含：age, gender, height, currentWeight, activityLevel,
//              bmrMethod, bodyFatPercentage, targetWeight, targetDate
// Katch–McArdle 必须已有或同时提供有效体脂率；不得由 Agent 猜测。
// 任意子集。改完后实时重算 BMR/TDEE/目标缺口。
// 返回：更新后的完整 profile（同 getProfile 返回结构）。

editLibrary({ action: 'add'|'update'|'remove', item })
// 手动管理食物库。add/update 传入 FoodLibraryItem 子集。
// 返回：操作结果。

updateUserMemory({ content, expectedVersion })
// 乐观锁替换整份 Markdown；只保存用户明确要求或确认的长期偏好、限制与约定。
// 不复制体重、目标、日志等结构化数据，不保存秘密、短期状态或未经确认的推测。
```

### 不提供独立 analyze 路径

食物热量估算由**主对话模型在推理时直接完成**，作为 logFood 的入参。这样：
- 省一个网络来回（原版要先调 analyze 再保存）。
- 主模型可以根据上下文修正（"刚那个包子其实是肉的"直接改数值，不重算）。
- 库里命中的食物走快路径（agent 调 listLibrary 后直接用库值，不估算）。

## 六、卡卡的人格与语气

- **称呼**：自称"卡卡"，称呼用户"你"。
- **语气**：像一个懂行的朋友，专业但不端着，简洁直接。
- **风格**：
  - 记录后简短确认 + 一个有用信息（"记上了，牛肉面 ~520kcal，今天还剩 650"）。
  - 不啰嗦，不每条都教育；该提醒时才提醒。
  - 给建议带理由，给选项不替用户做决定（"晚餐加点蛋白比较好，鸡胸/鸡蛋/豆腐你选？"）。
  - 主动消息克制（饭点、睡前、平台期、周报），可关。

## 七、三页详细设计

### 1. 首页 Dashboard（只读 + 主动消息）

```
┌─────────────────────────────────┐
│ 今日预算 1850 · 已摄 1200 · 剩650 │  ← 状态条（点击进 AI 页）
├─────────────────────────────────┤
│ 今日                            │
│  • 08:30 两个包子 + 豆浆     520 │  ← 只读时间线
│  • 12:15 巨无霸套餐        1080 │     点条目跳 AI 页继续聊
│  • 18:00 跑步 30min      -320   │
├─────────────────────────────────┤
│ 卡卡的消息                       │
│  📌 平台期检测：体重两周没动了…  │  ← Agent 主动消息
│  🌙 昨日小结：摄入 1700，达标   │     点击进对应 session
│  📊 本周周报                    │
├─────────────────────────────────┤
│ 体重趋势（30天迷你图）  -1.2kg  │
├─────────────────────────────────┤
│ 训练计划 · 今日轻松跑 · 2/5 完成 │
├─────────────────────────────────┤
│         [和卡卡聊聊 →]           │  ← CTA，跳 AI 页
└─────────────────────────────────┘
```

- **训练计划卡片**：展示当前计划、今日/逾期/下一项安排和完成进度；无计划时链接到创建页。
- **空状态**：无数据时只显示 CTA + 引导文案。
- **主动消息**：agent 后台生成的消息存入一个"默认/每日 session"或独立表，首页展示未读，点击进 AI 页对应 session。

### 1.1 运动记录页

`/exercise` 从首页运动汇总进入，提供 7 天 / 30 天 / 90 天 / 全部范围：

- 汇总训练次数、总时长、活跃天数和估算消耗。
- LayerChart 每日运动分钟柱状图。
- 按日期分组的记录列表，支持新增、编辑和左滑确认删除。
- 手动表单按当前体重、运动类型、强度和时长使用 MET 估算消耗，也允许用户按设备数据修正。
- 运动消耗仅用于记录与趋势，不直接增加每日饮食预算，避免和 Formula / Adaptive TDEE 重复计算。

### 2. AI 页（主战场）

```
┌─────────────────────────────────┐
│ [☰] 今日减脂           [···]    │  ← 顶部：session 抽屉触发 + 标题
├─────────────────────────────────┤
│                                 │
│  你：刚吃了碗牛肉面              │
│  卡卡：记上了 ~520kcal           │
│        ┌──────────────────┐    │
│        │ 🍜 牛肉面  520kcal │    │  ← food_logged 卡片
│        │ P 22 C 65 F 18   │    │
│        └──────────────────┘    │
│        今天还剩 650，晚餐建议…  │
│                                 │
├─────────────────────────────────┤
│ [📷] [🎤]  说点什么...    [↑]   │  ← 输入栏：拍照/语音/文字
└─────────────────────────────────┘
```

- **Session 抽屉**（顶部 ☰ 触发，下拉式）：
  - 列出所有 session（标题 + 最后消息时间 + 预览）。
  - 顶部"新建对话"按钮。
  - 选中切换当前 session。
- **消息流**：
  - user / assistant 文本气泡。
  - tool_call → tool_result 渲染为对应 Card（食物记录卡/目标方案卡等）。
  - 卡片内可点改（如点食物卡片改数值）。
- **输入**：文字、拍照、语音三种，进同一个对话流。
- **首条消息**：新 session 时 agent 主动开场（"你好，我是卡卡，今天想吃点什么/聊聊目标？"）。

### 3. 设置页

`/settings` 仅作为分组导航入口，不显示具体资料值。功能拆分为 `/settings/profile`、`/settings/ai`、`/settings/library`、`/settings/preferences` 与 `/settings/data`。

**A. 资料与目标页**

基础资料与减脂目标保留在同一页，但分成两个清晰区域。

**基础信息区域**
- 性别 / 年龄 / 身高 / 当前体重 / 活动水平（5 档）。
- 体脂率可选；Formula TDEE 默认使用 Mifflin–St Jeor，填写有效体脂率后可改用 Katch–McArdle。
- 实时展示：所选公式计算的 BMR + Formula TDEE。
- 自适应 TDEE 展示（置信度条），若已有数据。

**目标设定区域**
- 目标体重 + 目标日期输入。
- 实时计算并展示：
  - 每周减重量 = (当前 - 目标) / 周数
  - 每日热量缺口 = 每周减重 × 7700 / 7
  - 安全提示：
    - 每周 > 1kg 或 > 体重 1% → 红「过快，掉肌肉/反弹风险」
    - 每周 0.5-1kg → 绿「推荐区间」
    - 每日缺口 > 1000kcal 或低于 BMR → 警告
- 「让卡卡推荐」按钮 → 跳 AI 页新建 session，agent 给方案。

**B. AI 配置页**
- API Key（一键授权 + 手动输入 + 显示/隐藏）。
- 模型选择（动态拉取列表）。

**C. 食物库管理页**（从设置页进入）
- 列表（按 category 分组或最近使用排序）。
- 增/删/改/合并去重。
- 搜索。
- 说明：条目主要由卡卡自动沉淀，这里用于纠偏。

**D. 卡卡的记忆页**
- 查看、编辑、预览与清空跨会话 Markdown 记忆。
- 明确记忆快照会发送给当前模型服务，并包含在完整备份中。

**E. 偏好页**
- 当前仅提供界面与 Agent 回复语言切换，后续承载主题、单位等应用偏好。

**F. 数据与隐私页**
- 导出 JSON / 导入 JSON / 清空数据。
- 备份格式为 v4，包含 UserMemory、TrainingPlan、PlannedWorkout、PluginConfig 与 PluginData；导入继续兼容 v1–v3 备份。
- 明确完整备份包含健康数据、聊天图片、卡卡的记忆与明文 API Key。

## 八、首次引导流

```
首次打开或必要配置遗失
  → /onboarding 欢迎页（语言与本地优先说明）
  → /onboarding/profile 填写基础资料，创建当天初始体重并计算 BMR/TDEE
  → /onboarding/ai 配置接口协议、Model ID 与 API Key
  → 两项配置完整后新建首个 session 并进入 AI 页
  → 卡卡主动开场（"你好，我是卡卡！你的资料和 AI 连接已经准备好了……"）
```

基础资料或 AI 配置任一缺失时，全局路由守卫会自动回到对应引导步骤；设置页只承担完成 onboarding 后的修改与管理。

## 九、技术栈与关键决策（v2，SvelteKit 版）

项目仓库位于 `../kalo-ai`，采用 Bun monorepo；当前应用 package 位于 `apps/web`。

### 9.1 核心栈

| 项 | 选型 | 说明 |
|----|------|------|
| 框架 | **SvelteKit 2 + Svelte 5（强制 runes）** | 文件路由，SSR 默认开 |
| 语言 | TypeScript | |
| 构建 | Vite 8 + Bun | |
| 样式 | Tailwind CSS 4（CSS-first） | |
| i18n | Paraglide（zh-cn 主 / en-us） | 已就绪 |

### 9.2 适配器与部署

- **adapter-static（SPA fallback）** —— 已配置。产出一个可安装的静态站，数据全在浏览器 IndexedDB，服务端不参与业务。
- **零业务服务端**：因为 AI 改用用户自带的 OpenAI/Anthropic key（见 9.5），原 CalorieAI 里为 Pollinations 授权准备的 `/api/config` 端点彻底不需要了。SvelteKit 的 `+server.ts` 只在需要时才写，第一版不写任何端点。

### 9.3 UI 组件：Konsta UI

- **npm：konsta（5.2.0）**，Svelte 5 runes 兼容，iOS / Material 双主题自动识别。用 `App` 组件包根（设 `theme` / `dark` / `safeAreas`）。
- 关键复用：
  - `Tabbar` + `TabbarLink` —— 底部 3-Tab 导航，中间 AI 按钮做成凸起（`Fab` 叠加或自定义 tabbar-link 样式）。
  - `Messages` + `Message` + `Messagebar` —— AI 页聊天套件开箱即用（这是选 Konsta 的核心理由）。
  - `List` / `ListItem` / `ListInput` / `ListGroup` —— 设置表单、食物库。
  - `Card` / `Block` / `BlockTitle` —— 内容卡片。
  - `Sheet` / `Popup` / `Dialog` / `Actions` —— Session 抽屉、食物编辑、确认。
  - `Segmented` —— Dashboard 快捷记录切换（饮食/运动/体重）。
  - `Progressbar` / `Stepper` / `Toggle` / `Radio` —— 进度与表单控件。
  - `Toast` / `Preloader` —— 反馈与加载。
- **Tailwind 4 集成**：Konsta 的类需被 Tailwind 扫描到，在 CSS 入口用 `@source` 把 `node_modules/konsta` 纳入扫描，避免样式被 purge（实施时验证）。

### 9.4 数据与状态

- **Dexie.js（IndexedDB）**，浏览器端。SSR 期间不实例化：所有 DB 访问仅在 `onMount`/浏览器上下文内进行，组件里用 `browser`（`$app/environment`）守卫。
- **状态管理**：Svelte 5 runes。不引入 store 库。用一个 `appContext.svelte.ts`（`$state` 容器 + `getContext`/`setContext`）替代旧 AppContext，持有 user / aiConfig / 当前 session / today 数据。

### 9.5 AI 集成：@earendil-works/pi-agent-core + @earendil-works/pi-ai（关键）

- **库**：`@earendil-works/pi-agent-core` 0.84.x 负责 Agent 状态、tool-calling 循环、工具校验/执行与生命周期事件；底层使用 `@earendil-works/pi-ai` 0.84.x 统一不同 LLM provider 的流式 API。完全取代原 Pollinations 封装。
- **浏览器直连**（已调研确认可行）：`createModels()` → `createProvider()` 注册用户自配端点 → `models.complete(model, context, { apiKey })`。每个请求显式传 apiKey，key 仅存本地（Dexie 的 AIConfig 表）。**明确告知用户：CORS 取决于其 endpoint，部分代理/网关可能需要支持 CORS。**
- **用户在设置页配置（AI 配置卡）**：
  - API 类型三选一：`openai-completions` / `openai-responses` / `anthropic-messages`
  - baseURL（openai 系留空=官方；anthropic 留空=api.anthropic.com；或填自建网关/代理）
  - API Key
  - model id（自由输入）
- **落地方式**：把用户配置映射成一个自定义 provider，注册进 `createModels()`：
  ```ts
  import { createProvider } from '@earendil-works/pi-ai';
  import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
  // 按 apiType 选 api 实现（lazy 三选一），用 createProvider() 造一个 provider
  ```
- **Agent 循环**：使用 `Agent`，通过 `models.streamSimple.bind(models)` 注入模型 transport。Agent 负责流式响应、工具参数校验、工具执行、toolResult 回填和后续模型调用；应用订阅 `message_update` / `message_end` / `tool_execution_*` / `agent_end` 事件更新 UI 并持久化 Dexie。
- **工具定义**：使用 `AgentTool` + TypeBox `Type.Object(...)`，与第五节的工具签名一致。会修改健康数据的工具按 `sequential` 顺序执行；工具失败时抛出错误，由 Agent 转换为 `isError` toolResult。注意用 `StringEnum`（非 `Type.Enum`）以兼容 Google 系。
- **图片输入**：聊天支持单张 JPEG/PNG/WebP/GIF，经浏览器端缩放和重编码后作为 `ImageContent` 保存并发送。当前活跃上下文保留历史图片，与 pi coding agent 的上下文语义一致；不单独实现图片摘要或图片专用 compaction。
- **不再有独立 analyze 路径**：食物估算由主模型在推理时直接产出数值传给 `logFood`。

### 9.6 编译期插件机制

- `packages/plugin-sdk` 定义 manifest、TypeBox 配置、设置字段、权限声明、AgentTool、System Prompt 扩展与受控 services。
- 插件作为 `packages/plugin-*` Bun workspace package，由 `apps/web/src/lib/plugins/registry.ts` 在构建时显式注册；不允许运行时安装任意远程代码。
- 启用插件的工具会和核心 AgentTool 合并；工具名必须以 `${pluginId}_` 开头且全局唯一。
- 启用插件可提供受长度限制的 Prompt section，在核心 System Prompt 后按稳定顺序追加，从下一轮对话生效。
- `pluginConfigs` 保存启用状态、配置版本和 JSON 配置；`pluginData` 提供按 pluginId 隔离的私有 KV 存储，两者均进入完整备份。
- 设置页提供 `/settings/plugins` 与 `/settings/plugins/[pluginId]`，第一版支持 text/password/number/toggle/select schema-driven 配置。
- 插件代码和 Web App 运行在同一浏览器上下文，不是真正沙箱，因此只集成经过审查的 package，并在 UI 展示声明权限。
- `plugin-mcdonalds-sg` 内置新加坡麦当劳官网营养静态快照，提供 Full Menu / 官网分类 `{id,name}` 列表与准确 ID 营养查询；服务端更新脚本仅在规范化产品或分类数据变化时改写 JSON，定时 GitHub Actions 据此自动创建更新 PR。

### 9.7 图表

- **LayerChart**（Svelte 原生，基于 d3）—— 体重折线、热量柱状、运动趋势。
- **手搓 SVG** —— 进度环、迷你趋势 sparkline（用库反而麻烦）。
- ⚠️ 实施前先确认 LayerChart 对 Svelte 5 的兼容性；不兼容则降级为全手搓 SVG（我们图都不复杂）。

### 9.8 PWA

- `@vite-pwa/sveltekit` —— manifest + service worker + 缓存策略自动生成。
- 配置：name=「Kalo AI」、short_name=「Kalo」、theme_color=emerald、standalone、portrait。

## 十、目录结构（Bun Monorepo）

仓库使用 Bun workspace：当前 Web PWA 位于 `apps/web`，后续共享模块放入 `packages/*`。根目录保留 workspace 脚本、Biome、Wrangler 和项目文档。

```text
apps/web/src/
├── lib/
│   ├── server/                    # （第一版为空，无业务端点）
│   ├── db/
│   │   ├── schema.ts              # Dexie 定义（含 Session/Message/FoodLibraryItem）
│   │   └── repositories.ts        # 各表数据访问
│   ├── agent/
│   │   ├── tools.ts               # 核心 TypeBox AgentTool schema + handler
│   │   ├── client.ts              # pi-agent-core 适配（事件持久化 + UI 回调）
│   │   ├── provider.ts            # 用户配置 → createProvider/createModels
│   │   ├── systemPrompt.ts        # 卡卡人格 + 工具使用指引
│   │   └── proactive.ts           # 主动消息生成（饭点/睡前/周报/平台期）
│   ├── plugins/
│   │   ├── registry.ts            # 构建时显式注册 workspace 插件
│   │   ├── manager.ts             # 配置、工具与 Prompt 聚合
│   │   └── services.ts            # 受控 profile/log/storage/fetch 能力
│   ├── utils/
│   │   ├── calculations.ts        # BMR/TDEE/TEF/目标缺口/安全判定
│   │   ├── adaptiveTDEE.ts        # 自适应 TDEE
│   │   ├── exercise.ts            # MET 运动消耗估算
│   │   ├── trends.ts              # 趋势分析（平台期/异常/预测）
│   │   └── librarySync.ts         # logFood 后自动沉淀食物库
│   ├── context/
│   │   └── appContext.svelte.ts   # runes 全局状态
│   ├── components/
│   │   ├── Nav.svelte             # 3-Tab + 中间凸起（Konsta Tabbar）
│   │   ├── chat/
│   │   │   ├── MessagesView.svelte
│   │   │   ├── Composer.svelte    # 文字/拍照/语音三输入
│   │   │   ├── SessionDrawer.svelte
│   │   │   └── cards/             # FoodCard / GoalCard / TrendCard / SummaryCard
│   │   └── charts/
│   │       ├── ProgressRing.svelte
│   │       ├── WeightTrend.svelte
│   │       ├── ExerciseMinutesChart.svelte
│   │       └── CalorieTrend.svelte
│   ├── paraglide/                 # 自动生成
│   └── assets/
├── routes/
│   ├── +layout.svelte             # Konsta App 包根 + Nav + 引导守卫
│   ├── +layout.ts                 # prerender=false, ssr=true（但 DB 仅浏览器用）
│   ├── +page.svelte               # 首页 Dashboard
│   ├── exercise/
│   │   ├── +page.svelte           # 运动历史、图表与手动 CRUD
│   │   └── plan/+page.svelte      # 未来训练计划与完成流
│   ├── chat/
│   │   ├── +page.svelte           # 无 sessionId → 新建/选最近
│   │   └── [sessionId]/+page.svelte
│   ├── onboarding/                # 欢迎、基础资料、AI 连接三步引导
│   └── settings/
│       ├── +page.svelte           # 仅显示分组设置入口
│       ├── profile/+page.svelte   # 基础资料 + 减脂目标
│       ├── ai/+page.svelte        # 模型、接口与 API Key
│       ├── plugins/               # 插件列表与 schema-driven 配置
│       ├── preferences/+page.svelte # 语言等应用偏好
│       ├── memory/+page.svelte    # 跨会话 Markdown 用户记忆
│       ├── data/+page.svelte      # 备份、恢复、隐私与清空
│       └── library/+page.svelte   # 食物库管理
├── app.html
├── app.d.ts
└── hooks.server.ts                # Paraglide 中间件（已有）

packages/
├── plugin-sdk/                    # 稳定插件协议与 definePlugin
├── plugin-example/                # 默认停用的工具/Prompt/设置示例
└── plugin-mcdonalds-sg/           # 新加坡麦当劳营养静态快照与查询工具
package.json                       # Bun workspaces + 根代理脚本
wrangler.jsonc                     # 部署 apps/web/build，SPA fallback
```

## 十一、实施顺序（v2）

1. **骨架**：adapter-static 验证 → PWA 接入 → Konsta App 包根 + 3-Tab 导航 + 路由壳子。
2. **数据层**：Dexie schema（含新表）+ repositories + appContext（runes）。
3. **计算层**：calculations（补目标缺口/安全判定）+ librarySync + trends（从旧项目移植）。
4. **Agent 层**：provider.ts（用户配置→pi-ai）+ systemPrompt + AgentTool 工具集 + client（pi-agent-core 生命周期与 Dexie 适配）。
5. **设置页**：主导航页 + 资料与目标、AI、食物库、偏好、数据与隐私子页。
6. **AI 页**：session 管理（Konsta Messages/Messagebar）+ 卡片渲染 + 三种输入 + tool-call 消息渲染。
7. **首页**：状态条 + 今日时间线（只读）+ 主动消息入口 + 趋势图。
8. **收尾**：主动消息生成器、i18n 文案、图标、PWA 测试。

## 十二、Backlog（第一版不做）

- **Undo**：事件溯源 + Operation 表 + 「撤销到此消息」。方案已设计，因复杂度高推迟。
- 语音输入（需 ASR）。
- 推送通知（需通知权限）。
- Apple Health / Google Fit 集成。
- 深色模式开关（Konsta 已支持 dark，需加开关）、多语言。
- 云端同步。
