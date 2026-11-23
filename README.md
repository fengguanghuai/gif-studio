# GIF Studio

面向普通用户的极简 AI GIF 表情包工作台，基于 OpenAI GPT Image 2.6 原生 GIF 能力构建（暖纸极简风）。

## 特性

- **开箱即用**：模型与 API Key 统一在服务端配置，前端零配置门槛。
- **Auto 极简模式**：默认只需选模型 + 传参考图（可选）+ 写一句话，后台自动套用预制无缝循环 GIF 提示词。
- **高级自定义模式**：一键展开帧数、单帧时长、背景（透明/纯白/自动）、画质、复杂度，以及预制 GIF 提示词模板编辑器。
- **支持文生 GIF & 图生 GIF**：传参考图时自动走 `/v1/images/edits` 并切换角色锁定模板；支持拖拽与剪贴板粘贴图片。
- **易扩展配置**：模型清单在 `config/models.json`，预制提示词在 `config/presets.json`。

## 快速启动

需要 Node.js >= 22。

```bash
npm install
OPENAI_API_KEY=sk-... npm start
```

默认监听 `http://127.0.0.1:4318/`。可通过环境变量覆盖 `OPENAI_API_BASE_URL`、`HOST`、`PORT`。
