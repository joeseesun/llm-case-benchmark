# Case Benchmark · DESIGN.md

## 1. Visual Theme & Atmosphere
Arena Console：浅色为默认（2026-07-09），深色为第二主题。气质像 LMSYS Arena × Cursor 工具感，不是营销落地页。青绿 accent 作运行态与选中态；等宽字体承担模型名、延迟、token 等元数据。

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
- Left case rail / board filter chips
- Model columns (2–4) with header + body
- Run bar sticky bottom of compare pane
- Settings drawer for API keys (localStorage only)
- Contribution gallery cards
- Theme toggle + affordance icons (reward / follow)

## 5. Layout
- Desktop: `240px | 1fr` case rail + compare stage
- Case board mode (from direction C): filter chips + card grid when browsing
- Mobile: single column; cases as horizontal chips; model columns stack

## 6. Depth
- Cards: 1px border + soft tinted shadow `0 8px 24px rgba(0,0,0,.25)` dark / `.06` light
- Active case: elevated fill + full 1px border (NO left vertical accent bar)
- Focus ring: `0 0 0 2px var(--bg), 0 0 0 4px var(--accent)`

## 7. Do's / Don'ts
- Do: same prompt text shared across all model columns
- Do: sandboxed iframe for frontend HTML previews
- Don't: store API keys on server
- Don't: purple gradient glow, pure black #000, Inter/Roboto

## 8. Responsive
- Break at 900px to single column
- min-h 100dvh; no horizontal page scroll

## 9. Motion
- 120–200ms ease-out for hover/panel
- List stagger ≤50ms; respect prefers-reduced-motion
- Signature: Run button press scale(0.97) + accent pulse while loading
