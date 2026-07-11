/* Curated prompt cases inspired by public evaluation projects; prompts are original Chinese rewrites. */
(() => {
  'use strict';

  const cases = [
    {
      id: 'creative-thirteenth-floor', title: '不存在的十三层', category: '创意表达',
      summary: '用禁词、字数和首尾回环，考验悬疑叙事的控制力。', tags: ['悬疑', '首尾回环', '禁词'], outputType: 'text', inspiredBy: ['mt-bench', 'arena-hard'],
      prompt: '写一篇 260—340 字的中文微型悬疑故事。开头和结尾必须完全相同：“电梯在十三层停了。”结尾再次出现时，要让这句话产生与开头不同的含义。故事中只能出现两名人物；不得使用“梦”“鬼”“原来”“突然”；不要解释谜底。',
    },
    {
      id: 'creative-three-genres', title: '同一事实，三种文体', category: '创意表达',
      summary: '在事实不变的前提下，分别改写成简报、日记和诗歌。', tags: ['改写', '文体', '信息守恒'], outputType: 'text', inspiredBy: ['mt-bench'],
      prompt: '请严格依据以下事实，分别写成三种文体：雨天 7:40，一名外卖骑手在公交站捡到一把小提琴，8:15 将琴交还失主。依次写：①警情简报，不超过 80 字；②十岁孩子的日记，120—160 字；③八行自由诗。不得补充姓名、地点、动机或因果。',
    },
    {
      id: 'creative-unnamed-shop', title: '可以收回一句话的商店', category: '创意表达',
      summary: '在概念设定和禁词约束下，写一则克制的广告。', tags: ['广告', '禁词', '概念创意'], outputType: 'text', inspiredBy: ['arena-hard'],
      prompt: '有一家商店，可以帮顾客收回一句已经说出口的话。请为它写一则 150—220 字的广告。不得出现“后悔、时间、记忆、梦”四个词，也不要解释技术原理。结尾必须是一句风险警告，不能是购买号召。',
    },
    {
      id: 'creative-server-dialogue', title: '机房里的十二句', category: '创意表达',
      summary: '只靠短对话完成冲突升级与行动收束。', tags: ['对话', '约束写作', '机房'], outputType: 'text', inspiredBy: ['mt-bench', 'arena-hard'],
      prompt: '只写 12 行对话，不要旁白。对话双方是两名当班工程师，正在争论是否重启支付服务；每行不超过 16 个汉字。前 6 行要让冲突逐步升级，后 6 行必须收束成可执行方案。“回滚”和“重启”各出现且只能出现一次；不得使用“我觉得”。',
    },
    {
      id: 'reasoning-talk-order', title: '四场分享的唯一顺序', category: '推理判断',
      summary: '从相邻、位置与先后约束推出唯一排程。', tags: ['排程', '逻辑', '唯一解'], outputType: 'text', inspiredBy: ['bigbench', 'livebench'],
      prompt: '四场分享依次在 9:00、9:30、10:00、10:30 开始，四位讲者分别姓吴、周、林、梅。林讲完后紧接着是梅；周既不是第一位，也不是最后一位；吴在梅之前。请给出唯一顺序，并用不超过 120 字说明排除过程。',
    },
    {
      id: 'reasoning-two-true', title: '恰好两句是真的', category: '推理判断',
      summary: '检验真假命题枚举和逐项验证能力。', tags: ['真假命题', '枚举', '密码'], outputType: 'text', inspiredBy: ['bigbench', 'bbeh'],
      prompt: '密码是 1–9 中的一个整数。以下四句话恰好两句为真：A. 密码是偶数；B. 密码大于 5；C. 密码能被 3 整除；D. 密码是 8。求密码，并逐句标出真/假。',
    },
    {
      id: 'reasoning-coffee-cause', title: '换音乐让销量涨了 42% 吗', category: '推理判断',
      summary: '识别混杂因素，并设计低成本的因果验证方案。', tags: ['因果', '实验设计', '混杂因素'], outputType: 'text', inspiredBy: ['bigbench', 'livebench'],
      prompt: '某咖啡店本周五更换了背景音乐，当天饮品销量比上周五高 42%。但当天还下雨、门店发了九折券，附近一家竞争门店又恰好停电。现有证据能否说明销量增长是音乐造成的？请至少列出 3 个混杂因素，再设计一个成本尽可能低、能在两周内完成的验证方案。',
    },
    {
      id: 'reasoning-token-strategy', title: '17 枚筹码必胜策略', category: '推理判断',
      summary: '要求给出策略，并用不变量进行短证明。', tags: ['博弈', '不变量', '证明'], outputType: 'text', inspiredBy: ['bigbench', 'bbeh'],
      prompt: '桌上有 17 枚筹码，两人轮流拿 1–4 枚，拿到最后一枚者获胜。你先手。给出保证获胜的第一步和之后策略，并用一个不超过 80 字的不变量证明。',
    },
    {
      id: 'instruction-four-lines', title: '四行藏头硬约束', category: '指令遵循',
      summary: '同时检验行数、字数、藏头与字符禁用。', tags: ['行数', '字数', '藏头'], outputType: 'text', inspiredBy: ['ifeval'],
      prompt: '只输出 4 行中文，每行恰好 8 个汉字（行首字计入），不含数字、字母、标点或空格。四行首字依次为“模、型、对、比”，主题是雨夜赶路。不要输出其他内容。',
    },
    {
      id: 'instruction-json-only', title: '严格 JSON 任务板', category: '指令遵循',
      summary: '测试纯 JSON、键顺序、枚举值与数量约束。', tags: ['JSON', '格式', '键顺序'], outputType: 'text', inspiredBy: ['ifeval', 'openai-evals'],
      prompt: '只输出合法的 JSON 数组，不要使用代码围栏。数组中必须恰好有 3 个对象；每个对象的键都要严格按 id、status、owner 的顺序出现。id 依次为 1、2、3，status 依次为 "pending"、"doing"、"done"，owner 为 2—3 个汉字。不得出现其他键。',
    },
    {
      id: 'instruction-table-total', title: '只给一张结算表', category: '指令遵循',
      summary: '格式约束和基础计算必须同时正确。', tags: ['Markdown', '表格', '计算'], outputType: 'text', inspiredBy: ['ifeval'],
      prompt: '只输出一张 Markdown 表格，表格外不要有任何文字。列名依次为“项目”“单价”“数量”“小计”。数据为：A 单价 120、数量 2；B 单价 85、数量 3；C 单价 50、数量 4。再增加一行“合计”，其中单价和数量填“-”，小计填写三项总额。除表头和分隔线外，必须恰好有 4 行数据。',
    },
    {
      id: 'instruction-two-paragraphs', title: '小工具优化到什么程度该停', category: '指令遵循',
      summary: '同时约束段落、句数、字数、禁词和固定结尾。', tags: ['段落', '禁词', '固定结尾'], outputType: 'text', inspiredBy: ['ifeval'],
      prompt: '请回答：什么时候应该停止优化一个小工具？答案必须恰好分成两段：第一段恰好 2 句，第二段恰好 1 句；全文为 90—120 个汉字，不计标点符号；不得使用“首先”“其次”“最后”；全文最后一句必须完全等于“能用且可维护，就够用。”',
    },
    {
      id: 'code-merge-ranges', title: '合并时间区间', category: '编码调试',
      summary: '用边界条件和断言验证 Python 实现完整度。', tags: ['Python', '区间', '边界'], outputType: 'text', inspiredBy: ['humaneval', 'bigcodebench'],
      prompt: '用 Python 实现 `merge_ranges(ranges)`。输入是若干 `[start, end]` 区间，排列顺序任意；当两个区间有重叠，或前一区间的 `end` 恰好等于后一区间的 `start` 时，必须合并。结果按 `start` 升序排列；不得修改原输入；任一区间满足 `start > end` 时抛出 `ValueError`。只输出可直接运行的完整 Python 代码，并在代码中加入 5 个 assert，覆盖空输入、乱序、端点相接、区间包含和非法区间。',
    },
    {
      id: 'code-lru-map', title: 'O(1) 的 LRU 缓存', category: '编码调试',
      summary: '检验 Map 顺序语义、复杂度与容量边界。', tags: ['JavaScript', 'LRU', '数据结构'], outputType: 'text', inspiredBy: ['humaneval', 'bigcodebench'],
      prompt: '用 JavaScript 实现 `class LRUCache`，构造参数 capacity 必须为正整数；`get(key)` 不存在返回 -1，存在则更新最近使用顺序；`put(key,value)` 插入或更新，超限淘汰最久未用项。要求 get/put 平均 O(1)，可使用 Map。只输出代码，包含 capacity=1 的演示。',
    },
    {
      id: 'code-async-order', title: 'forEach 异步陷阱', category: '编码调试',
      summary: '修复异步等待、输入顺序与单项容错问题。', tags: ['JavaScript', '异步', 'Debug'], outputType: 'text', inspiredBy: ['bigcodebench', 'mt-bench'],
      prompt: '修复以下代码，使它在所有请求结束后再返回，且返回结果与 `ids` 的输入顺序一致。某一项请求失败时，要在对应位置放入 `{id, error}`，不能让整批任务失败：\n```js\nasync function load(ids) {\n  const out = [];\n  ids.forEach(async id => out.push(await fetchOne(id)));\n  return out;\n}\n```\n先用恰好 2 句解释根因，再给出改动尽可能小的完整函数。',
    },
    {
      id: 'code-csv-line', title: '一行 CSV 解析器', category: '编码调试',
      summary: '不用库处理引号、转义、空字段与异常输入。', tags: ['JavaScript', 'CSV', '解析器'], outputType: 'text', inspiredBy: ['humaneval', 'bigcodebench'],
      prompt: '不使用第三方库，实现 `parseCsvLine(line)`：以逗号分隔字段；字段可以用双引号完整包裹；被双引号包裹的字段中可以出现逗号；两个连续双引号表示一个字面量双引号；支持空字段。双引号只能出现在字段开头并包裹整个字段；闭合引号后只能是逗号或行尾，否则抛错；遇到未闭合引号也要抛错。只输出 JavaScript 代码，并给出至少 6 个测试用例。',
    },
    {
      id: 'web-focus-timer', title: '专注计时器', category: '网页交互',
      summary: '计时状态、键盘操作、进度动画与无障碍一题覆盖。', tags: ['计时', '无障碍', '键盘'], outputType: 'html', inspiredBy: ['artifactsbench', 'webdev-arena'],
      prompt: '生成一个完整的单文件 HTML 专注计时器：专注 25 分钟、休息 5 分钟；可以开始、暂停和重置；倒计时结束后自动切换专注/休息阶段；按空格键切换开始/暂停，按 R 键重置；用圆环显示进度，浏览器标签标题同步显示剩余时间；按钮必须有可访问名称；支持 `prefers-reduced-motion`；中文界面，不使用外部依赖。',
    },
    {
      id: 'web-bill-splitter', title: '聚餐分账器', category: '网页交互',
      summary: '测试表单校验、实时计算、复制反馈和响应式。', tags: ['表单', '计算', '复制'], outputType: 'html', inspiredBy: ['artifactsbench', 'webdev-arena'],
      prompt: '生成一个完整的单文件 HTML 聚餐分账器：输入账单总额、人数和小费比例，实时显示含小费总额与每人应付金额。输入为空、金额或小费比例为负数、人数为 0 时，要显示明确的校验提示，页面不得出现 NaN 或 Infinity。提供“复制结算摘要”按钮和成功反馈；仅用键盘即可完成全部操作；窄屏不得出现横向滚动；中文界面，不使用外部依赖。',
    },
    {
      id: 'web-departure-board', title: '列车发车信息屏', category: '网页交互',
      summary: '检验搜索筛选、空状态以及桌面端和手机端布局。', tags: ['搜索', '筛选', '响应式'], outputType: 'html', inspiredBy: ['artifactsbench', 'webdev-arena'],
      prompt: '生成一个完整的单文件 HTML 列车发车信息屏。内置 6 条符合常识的模拟数据，包括时间、车次、目的地、站台和状态，并按发车时间排序；支持按目的地搜索，并可筛选“准点”“晚点”“检票”；没有匹配结果时显示可恢复的空状态；桌面端使用表格，窄屏使用卡片布局；中文界面，不使用外部依赖。',
    },
    {
      id: 'web-memory-grid', title: '几何图形翻牌游戏', category: '网页交互',
      summary: '实现完整的小游戏状态机，并兼顾键盘操作和窄屏体验。', tags: ['小游戏', '键盘', '状态机'], outputType: 'html', inspiredBy: ['artifactsbench', 'webdev-arena'],
      prompt: '生成一个完整的单文件 HTML 4×4 记忆翻牌游戏，使用 8 对纯 CSS 几何图形，不使用 emoji 或图片。记录步数和用时；配对成功的牌保持翻开；全部配对后显示自定义通关弹层，不得使用 `alert`；支持重新开始。每张牌可用 Tab 聚焦，并可按 Enter 或空格键翻开；窄屏下也能正常游玩；不使用外部依赖。',
    },
    {
      id: 'svg-rube-machine', title: '连锁机关动画', category: 'SVG 视觉',
      summary: '把多段因果动作清晰编排成无缝循环的 SVG 动画。', tags: ['SVG', '动画', '时序'], outputType: 'html', inspiredBy: ['svgenius', 'artifactsbench'],
      prompt: '只输出一个可直接在浏览器中打开的完整 SVG，`viewBox="0 0 800 500"`。画一套连锁机关：小球滚下斜坡、撞倒骨牌、压下杠杆，最终敲响铃；动作的因果顺序必须清楚，整个过程形成 8 秒无缝循环；不使用 JavaScript 或外部资源；包含 `<title>` 和 `<desc>`；用户开启 `prefers-reduced-motion` 时显示静止画面。',
    },
    {
      id: 'svg-isometric-bookshop', title: '等距深夜书店', category: 'SVG 视觉',
      summary: '用冷暖关系、等距几何和细节层级测试视觉表达。', tags: ['SVG', '等距插画', '细节'], outputType: 'html', inspiredBy: ['svgenius', 'artifactsbench'],
      prompt: '只输出一个可直接在浏览器中打开的完整 SVG，`viewBox="0 0 800 600"`。画一间等距视角的深夜小书店：三排书架、梯子、收银台、窗外细雨，以及一只躲在桌下的猫；室内采用暖光，窗外采用冷色调，细节清楚但不过度堆砌；鼠标悬停在书店窗户区域时，灯光要有轻微变化；包含 `<title>` 和 `<desc>`；不使用外部资源。',
    },
    {
      id: 'svg-rainfall-poster', title: '七日降雨数据海报', category: 'SVG 视觉',
      summary: '把精确数据、刻度和主题插画组合成可读海报。', tags: ['SVG', '图表', '信息设计'], outputType: 'html', inspiredBy: ['svgenius', 'artifactsbench'],
      prompt: '只输出一个可直接在浏览器中打开的完整 SVG，`viewBox="0 0 900 560"`。把周一至周日的降雨量 `[12, 28, 7, 45, 31, 18, 39]` mm 做成数据海报：必须有精确刻度、每根柱子的具体数值、中文星期标签、平均值参考线，以及一处云雨主题插画；采用浅色配色，保证文字清晰，缩放后仍然可读；包含 `<title>` 和 `<desc>`；不使用外部资源。',
    },
    {
      id: 'svg-day-night-badge', title: '昼夜循环徽章', category: 'SVG 视觉',
      summary: '测试形状、色彩状态和无缝动画循环。', tags: ['SVG', '徽章', '循环动画'], outputType: 'html', inspiredBy: ['svgenius', 'artifactsbench'],
      prompt: '只输出一个可直接在浏览器中打开的完整 SVG，`viewBox="0 0 600 600"`。设计一枚圆形昼夜徽章：太阳沿弧线落下，月亮升起，天空和城市剪影随之变色；动画形成 10 秒无缝循环；画面中的可见文字只能是“昼”和“夜”；不使用 JavaScript 或外部资源；包含 `<title>` 和 `<desc>`；用户开启 `prefers-reduced-motion` 时显示静止画面。',
    },
    {
      id: 'role-outage-audiences', title: '同一故障，三种受众', category: '角色风格',
      summary: '在事实不变时为管理者、客户和工程师切换表达。', tags: ['受众适配', '事实守恒', '故障'], outputType: 'text', inspiredBy: ['mt-bench', 'arena-hard'],
      prompt: '已知事实只有这些：支付 API 在 14:10—14:37 期间部分请求异常，18% 的请求失败；失败请求经重试后成功；没有数据丢失；根因是数据库连接池配置，现已回滚。请分别写给：①CEO，不超过 80 字；②面向客户的状态页公告，80—120 字；③新入职工程师，120—180 字。不得补充赔偿方案、责任人或题目未提供的技术细节。',
    },
    {
      id: 'role-socratic-fraction', title: '不直接报答案的数学导师', category: '角色风格',
      summary: '用有限个递进问题引导学生自行纠错。', tags: ['苏格拉底', '教学', '分数'], outputType: 'text', inspiredBy: ['mt-bench'],
      prompt: '学生说：“3/4 + 1/6 = 4/10。”你是一名采用苏格拉底式提问的数学导师。最多只能问 4 个循序渐进的问题，引导学生自己发现问题；不要直接给出正确答案，不要说“你错了”，也不要使用夸奖式套话。第一个问题必须引导学生思考“分母能否直接相加”。',
    },
    {
      id: 'role-line-editor', title: '冷静但不刻薄的文字编辑', category: '角色风格',
      summary: '准确诊断冗长句，同时保持对作者的尊重。', tags: ['编辑', '改写', '批评'], outputType: 'text', inspiredBy: ['arena-hard', 'mt-bench'],
      prompt: '你是一名要求严格、但尊重作者的文字编辑。原句：“在当前复杂多变且充满不确定性的市场环境背景之下，我们需要进一步持续不断地加强对于用户真实核心需求层面的深入洞察。”请固定输出三部分：①列出 3 条诊断；②给出 50 字以内的改写；③分别说明改写中保留了什么、删掉了什么，以及原因，各 1 条。只批评文字，不评价作者。',
    },
    {
      id: 'role-launch-mediator', title: '明天演示，今天怎么收口', category: '角色风格',
      summary: '从立场深入利益，给出有时间盒和验收线的调解方案。', tags: ['调解', '决策', '验收'], outputType: 'text', inspiredBy: ['arena-hard', 'mt-bench'],
      prompt: '设计师要求做到像素级还原，工程师要求今天上线；明天要向客户演示，项目没有加班预算，也不能安排加班。你是调解人：先分别写出双方的“表面诉求”和“真正关切”，再给出一份 30 分钟会议议程，最后提出一套今天就能验收的折中方案，并列出 4 条验收标准。不要用“双方都有道理”敷衍。',
    },
    {
      id: 'fact-live-market-cap', title: '今天市值第一是谁', category: '事实审慎',
      summary: '测试模型能否承认实时数据边界，并给出核验路径。', tags: ['实时性', '不猜测', '核验'], outputType: 'text', inspiredBy: ['truthfulqa', 'simpleqa'],
      prompt: '用户问：“今天全球市值最高的公司是谁？请给精确市值和来源链接。”如果你无法访问实时市场数据，不要猜。先明确你能否验证，再给 3 步核验方法，并列出必须统一的口径：时间点、币种、盘前/盘后。回答要简洁可执行。',
    },
    {
      id: 'fact-phantom-paper', title: '那篇看似真实的论文', category: '事实审慎',
      summary: '面对虚构引用时拒绝补全不存在的论文细节。', tags: ['引用核验', '幻觉', '论文'], outputType: 'text', inspiredBy: ['truthfulqa', 'simpleqa'],
      prompt: '用户要求总结论文《Recursive Empathy in Quantum Chatbots》（MIT，2025，DOI:10.0000/reqc.2025.17），但没有提供正文。你不能检索。请说明哪些信息无法验证、为什么不能据此总结，并给出用户需要提供的最小材料清单。不得编造作者、实验或结论。',
    },
    {
      id: 'fact-microwave-myth', title: '微波炉会留下辐射吗', category: '事实审慎',
      summary: '纠正常见误区，同时保留科学与医疗建议边界。', tags: ['误区', '证据边界', '健康'], outputType: 'text', inspiredBy: ['truthfulqa'],
      prompt: '朋友说：“微波炉加热后的食物会残留辐射，长期吃一定致癌。”请用“结论 / 原理 / 仍需注意 / 何时咨询专业人士”四段回应。区分电离与非电离辐射，不使用“绝对安全”或“百分之百”措辞，也不要把建议写成诊断。',
    },
    {
      id: 'fact-conflicting-minutes', title: '冲突纪要能下结论吗', category: '事实审慎',
      summary: '在相互冲突的材料里区分确认事实与待验证意向。', tags: ['证据冲突', '置信度', '纪要'], outputType: 'text', inspiredBy: ['livebench', 'openai-evals'],
      prompt: '材料 A（周二 10:00）写“预算冻结，Q3 不采购”；材料 B（周二 16:00）写“财务口头同意追加 20 万，待 CFO 邮件确认”；周三没有新材料。回答：目前能确认什么、不能确认什么、最关键的下一步是什么。每个判断标“高/中/低”置信度，不把口头意向写成已批准。',
    },
    {
      id: 'data-latest-phone', title: '从订单更新记录中提取最终信息', category: '数据结构化',
      summary: '从更新记录中判断最终值，并严格输出 JSON。', tags: ['抽取', '冲突消解', 'JSON'], outputType: 'text', inspiredBy: ['livebench', 'bigbench'],
      prompt: '从以下材料中提取最终信息，只输出一个合法的 JSON 对象：\n“订单 QM-0711；收件人：林予安；电话 138 0013 8000；金额￥248.60。2026-07-12 备注：电话改为 13800138001；客服确认旧号码已作废。”\n字段固定为 orderId、recipient、phone、amount、phoneUpdatedAt；不得出现其他字段；amount 必须是数字；日期格式使用 YYYY-MM-DD。',
    },
    {
      id: 'data-weighted-ranking', title: '两个模型的加权排名', category: '数据结构化',
      summary: '检验加权计算、保留小数、排序和严格 JSON 结构。', tags: ['加权计算', '排名', 'JSON'], outputType: 'text', inspiredBy: ['livebench', 'bigbench'],
      prompt: '质量、速度、成本的权重分别为 0.5、0.3、0.2。模型 A 的三项得分为质量 86、速度 72、成本 90；模型 B 的三项得分为质量 82、速度 88、成本 75。分别计算加权总分，保留 1 位小数，并按总分从高到低排序。只输出合法 JSON，不要使用代码围栏：根对象只能包含 `ranking` 和 `winner`；`ranking` 必须包含两个模型，每项只能包含 `model` 和 `score`；`winner` 填得分最高的模型名。',
    },
    {
      id: 'data-contact-dedupe', title: '联系人去重合并', category: '数据结构化',
      summary: '按多条规范化规则合并时序联系人数据。', tags: ['去重', '规范化', '合并'], outputType: 'text', inspiredBy: ['livebench', 'bigbench'],
      prompt: '按 email 忽略大小写进行去重，并将输出的 email 统一转为小写；电话去掉空格和连字符。同一联系人按字段分别保留日期最新的非空姓名和电话，`updatedAt` 取该联系人的最后一条记录日期。输入：\n2026-07-01,乔木,joe@example.com,138-0013-8000\n2026-07-09,Xiangyang Qiaomu,JOE@example.com,13800138001\n2026-07-06,林舟,lin@example.com,\n只输出合法 JSON 数组，并按 email 升序排列；每个对象的键依次为 `name`、`email`、`phone`、`updatedAt`；缺失电话用 `null`。',
    },
    {
      id: 'data-calendar-ics', title: '两条日程转 iCalendar', category: '数据结构化',
      summary: '严格转换时区、重复规则与固定标识字段。', tags: ['iCalendar', '时区', '格式转换'], outputType: 'text', inspiredBy: ['livebench', 'bigbench'],
      prompt: '将以下两项日程转换为有效的 iCalendar 文本，时区均为 `Asia/Shanghai`：①从 2026-08-03 09:30—10:00 开始，每周一举行“例会”，共 4 次；②2026-08-14 14:00—15:30 举行“发布复盘”。两个事件的 UID 分别固定为 `weekly@qiaomu.ai` 和 `retro@qiaomu.ai`，DTSTAMP 均固定为 `20260711T080000Z`，SUMMARY 分别为“例会”和“发布复盘”。重复日程使用 `RRULE:FREQ=WEEKLY;COUNT=4`。只输出完整的 VCALENDAR 文本，不要使用代码围栏。',
    },
  ];

  window.CB_PROMPT_LIBRARY = Object.freeze(
    cases.map((item) => Object.freeze({ ...item, tags: Object.freeze(item.tags), inspiredBy: Object.freeze(item.inspiredBy) }))
  );
})();
