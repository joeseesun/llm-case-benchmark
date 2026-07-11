# Case Benchmark · DESIGN.md

## 1. Visual Theme & Atmosphere
Result Library Console：浅色为默认，深色为第二主题。气质像 LMSYS Arena × 高质量开发者文档，不是营销落地页，也不是空白的模型操作台。公开页首屏必须让访客看到已发布的真实模型输出；运行、设置与发布是第二层管理能力。青绿 accent 只承担互动、运行态、发布态与焦点环；等宽字体承担模型名、延迟、token、快照版本等可验证元数据。

参考 DNA：取 Linear 的 `6px / 8px / 12px` 功能圆角阶梯和“轻边框优先于重阴影”；取 Mintlify 的 `24px` 面板留白、`rgba(0,0,0,.05)` 细边框与 `0 2px 4px rgba(0,0,0,.03)` 微阴影。保留项目现有 Sora + 系统中文字体栈，不拷贝参考站的 Inter 或品牌色。

## 2. Color Palette & Roles
### Dark (default)
- bg: `#0e1015` · surface: `#171b24` · elevated: `#1a2030`
- text: `#e8eaef` · muted: `#8b93a7` · line: `#2a3140`
- accent: `#2dd4bf` · accent-ink: `#042f2e`
- danger: `#f87171` · success: `#34d399`

### Light
- bg: `#f7f7f5` · surface: `#ffffff` · elevated: `#f0f0ec`
- text: `#18181b` · muted: `#71717a` · line: `#e4e4e7`
- accent: `#0d9488` · accent-ink: `#ffffff`

## 3. Typography
- UI: Sora + system CJK stack
- Mono: JetBrains Mono for model IDs, latency, code
- No italic in UI
- Title tracking-tight; body max ~65ch in reading panes

## 4. Components
- Left case rail / board filter chips：每题同时显示“已发布模型数 + 更新时间”
- Published snapshot bar：精选结果版本、运行时间、成功/失败数、精确模型标识
- Prompt disclosure：默认保留题目摘要与评分标准，完整 Prompt 按需展开
- Model result columns (2–4) with header + body：公开页不依赖访客的本地模型配置
- Admin publish action：管理员运行成功后显示“发布为题库结果”，二次确认后生成不可变快照
- Run bar：“用本题复跑”为次级动作，管理员的发布动作只在存在成功结果时出现
- Settings drawer for API keys (localStorage only)
- Contribution gallery cards
- Theme toggle + affordance icons (reward / follow)

## 5. Layout
- Desktop: `240px | 1fr` case rail + compare stage
- Public default: 题目标题/快照元数据 → 已发布模型结果 → Prompt/评分标准；结果必须进入首屏
- Admin run mode: 可在同一题目下运行与发布，但不覆盖访客当前看到的精选快照，直到发布成功
- Mobile: single column；题目横向浏览；模型结果单列堆叠，禁止页面横向滚动

## 6. Depth
- Reading/result panels: 1px subtle border + `0 2px 4px rgba(15,55,50,.04)` light ambient shadow
- Modal/elevated panels: existing tinted shadow may rise to `0 8px 24px`, but ordinary sections stay flat
- Active case: elevated fill + full 1px border (NO left vertical accent bar)
- Focus ring: `0 0 0 2px var(--bg), 0 0 0 4px var(--accent)`

## 7. Do's / Don'ts
- Do: same prompt text shared across all model columns
- Do: public case only treats an admin-confirmed immutable snapshot as the featured result
- Do: preserve previous published versions and show exact run time/model identity
- Do: keep the last published snapshot visible while an admin reruns or while refresh fails
- Do: distinguish “暂无已发布结果” from search no-results, loading and network error
- Do: sandboxed iframe for frontend HTML previews
- Don't: store API keys on server
- Don't: auto-publish every admin run, user history, edited draft or partial in-progress output
- Don't: call a model the winner unless the scoring source and method are visible
- Don't: purple gradient glow, pure black #000, Inter/Roboto

## 8. Responsive
- Break at 900px to single column
- Public result cards stack at 900px; model identity and snapshot metadata wrap without truncating the exact model ID
- min-h 100dvh; no horizontal page scroll

## 9. Motion
- 120–200ms ease-out for hover/panel
- List stagger ≤50ms; respect prefers-reduced-motion
- Signature: result snapshot arrival uses a single 160ms opacity/translate transition; high-frequency case switching has no decorative animation
- Run/publish button press scale(0.97); accent pulse only while a real request is pending
