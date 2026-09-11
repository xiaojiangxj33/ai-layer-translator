# AI 图层翻译 / 图层工具（Photoshop CEP 扩展）

一个用于 Photoshop 的 CEP 面板插件，包含两大功能页：

1. **AI 图层翻译**：调用 OpenAI 兼容的大模型接口，把文档中所有**中文图层名批量翻译成英文**（支持自定义命名风格），翻译结果可预览、自动去重，确认后一键应用到 PS。
2. **图层工具**：日常图层整理实用工具合集。

---

## 功能一览

### 🈶 AI 图层翻译
- 一键扫描文档中所有含中文的图层名（含嵌套图层组）
- 调用大模型（支持任何 OpenAI 兼容接口，如智谱 GLM / DeepSeek / OpenAI 等）批量翻译
- 自定义翻译风格提示词（例如 snake_case、`part_subpart` 层级命名、`_L/_R` 对称命名等）
- 翻译结果自动清洗非法字符、自动去重（重名追加 `_2`、`_3`…）
- 翻译前后对照预览，确认后再应用到 PS

### 🛠 图层工具
| 功能 | 说明 |
|---|---|
| **检查重名/中文** | 一键检查文档图层，把含中文或重名的图层**标红** |
| **批量重命名** | 三种模式：`顺序命名`（基础名+序号）、`添加前缀`、`文件夹内图层重命名` |
| **文件夹内图层重命名** | 选中图层组（文件夹）后，将组内**所有图层改名为文件夹名**，不加后缀、名称完全相同（支持一键按钮直接执行） |
| **智能化图层** | 把选中的图层批量转换为智能对象（每个图层独立转换） |
| **批量导出 PNG** | 逐个导出全部顶层图层为 PNG（完整画布尺寸，不裁切），支持图层名或前缀+序号命名 |

---

## 环境要求

- **Photoshop CC 2019 及以上**（版本 20.0+，含 PS 2020 / 2021 / 2022 / 2023 / 2024…）
- Windows / macOS 均可
- ⚠️ **PS 2021（22.x）及以上**强制要求扩展签名，未签名扩展需开启调试模式，见下文「常见问题」

---

## 安装

1. 将整个 `com.aitranslate.layers` 文件夹复制到 Photoshop 安装目录下的：
   ```
   <Photoshop安装目录>\Required\CEP\extensions\
   ```
   > 绿色版 / 破解版同样适用，放到对应目录即可。
2. **重启 Photoshop**
3. 打开菜单：`窗口 → 扩展 → AI图层翻译`

---

## 使用说明

### AI 图层翻译页
1. 展开「API 配置」，填写 **Base URL**、**API Key**、**模型名**（配置输入即自动保存，存在插件目录内 `ai_layer_translator.json`，随插件一起携带）
2. 点击 **① 扫描中文图层**
3. 点击 **② AI 翻译**，在预览表中核对结果
4. 点击 **③ 应用到 PS**

> 兼容任意 OpenAI 格式接口。示例（智谱 GLM）：
> - Base URL：`https://open.bigmodel.cn/api/paas/v4`
> - 模型：`glm-4.5-flash`

### 图层工具页
- **检查重名/中文**：直接点击，问题图层会标红
- **批量重命名**：在 PS 中选中目标图层 → 点「批量重命名」→ 选择模式 → 确定
- **文件夹内重命名**（一键）：在 PS 中选中一个或多个图层组 → 直接点「文件夹内重命名」按钮，组内所有图层立即改为文件夹名
- **批量导出 PNG**：选择导出文件夹 → 选命名方式 → 开始导出

---

## 常见问题（FAQ）

### Q1：PS 2021+ 提示「未签署 / 无法验证扩展」
Adobe 从 PS 2021 起强制要求扩展签名。开启 CEP 调试模式即可放行未签名扩展：

- 方式一（推荐）：运行下方注册表脚本（Windows）：
  ```reg
  Windows Registry Editor Version 5.00

  [HKEY_CURRENT_USER\Software\Adobe\CSXS.11]
  "PlayerDebugMode"="1"
  ```
  > PS 2021~2023 对应 `CSXS.11`，PS 2024+ 对应 `CSXS.12`/`CSXS.13`，可把 9~14 全部建上。
- 方式二：`Win+R` → `regedit` → 定位到 `HKEY_CURRENT_USER\Software\Adobe\CSXS.11` → 新建字符串值 `PlayerDebugMode`，值设为 `1`

改完后**重启 Photoshop**。

### Q2：配置保存在哪里？
保存在**插件自身目录**下的 `ai_layer_translator.json`，随插件文件夹一起拷贝即可带走（换电脑无需重新配置）。

### Q3：翻译结果不符合命名风格？
在「API 配置」中修改「翻译风格提示词」即可，例如：
```
All parts use [part]_[subpart] format, lowercase, snake_case
Base parts layered from big to small, main to sub:
head_ — head
body_ — body
arm_ / leg_ / foot_ — arms/legs/feet
Symmetrical parts use _L / _R suffix, e.g. arm_L, arm_R
No Chinese, no spaces or hyphens, only lowercase letters and underscores
```

---

## 项目结构

```
com.aitranslate.layers/
├── CSXS/
│   └── manifest.xml          # CEP 扩展清单
├── client/
│   ├── index.html            # 面板界面
│   ├── main.js               # 面板逻辑（API 调用 / 图层工具前端）
│   └── style.css             # 样式
├── host/
│   └── index.jsx             # ExtendScript（PS 端：扫描/重命名/导出等）
└── CSInterface.js            # CEP 通信库
```

---

## 安全提示

- `ai_layer_translator.json` 内含你的 **API Key**，已通过 `.gitignore` 排除，**请勿提交或外传该文件**
- 插件文件夹请勿直接分享给他人（其中包含你的 API 配置）

---

## License

本项目仅供个人学习与使用。
