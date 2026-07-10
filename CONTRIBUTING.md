# Contributing

感谢你帮助改进乔木 LLM 擂台。

## 开始之前

1. 先搜索已有 Issue，确认问题尚未被处理。
2. 对较大的功能改动，先开 Issue 说明用户场景和交互边界。
3. 从 `main` 创建短期分支，保持改动聚焦。

## 本地开发

```bash
npm ci
npm test
npm start
```

提交 Pull Request 前，请确认：

- `npm test` 通过
- 没有提交 `.env`、SQLite 数据库、API Key、管理员口令或日志
- UI 改动在桌面与移动宽度下均可用
- 新增行为有对应测试或清楚说明无法自动测试的部分
- README 与配置示例和实际行为一致

## Pull Request

请说明改了什么、为什么这样改、如何验证，并为可见 UI 改动附上截图。保持一个 PR 只解决一个相对完整的问题。

English contributions are welcome. Please keep changes focused, run `npm test`, and never include credentials or production data.
