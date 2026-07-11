/* Curated prompt cases inspired by public evaluation projects; prompts are original Chinese rewrites. */
(() => {
  'use strict';

  const cases = [
    {
      id: 'creative-thirteenth-floor', title: '不存在的十三层', category: '创意表达',
      summary: '用禁词、字数和首尾回环测试悬疑叙事控制。', tags: ['悬疑', '首尾回环', '禁词'], outputType: 'text', inspiredBy: ['mt-bench', 'arena-hard'],
      prompt: '写一篇 260–340 字中文微悬疑。第一句和最后一句必须完全相同：“电梯在十三层停了。”但两次意思要发生变化。全篇只出现两个人，不得使用“梦”“鬼”“原来”“突然”，不要解释谜底。',
    },
    {
      id: 'creative-three-genres', title: '同一事实，三种文体', category: '创意表达',
      summary: '在信息守恒前提下完成简报、日记与诗歌改写。', tags: ['改写', '文体', '信息守恒'], outputType: 'text', inspiredBy: ['mt-bench'],
      prompt: '只使用以下事实写三段文字：雨天 7:40，一名外卖骑手在公交站捡到一把小提琴，8:15 交还失主。依次写：①警方简报（≤80 字）；②十岁孩子的日记（120–160 字）；③八行自由诗。不得新增姓名、地点或因果。',
    },
    {
      id: 'creative-unnamed-shop', title: '不能说名字的商店', category: '创意表达',
      summary: '带概念设定与禁词的克制广告创作。', tags: ['广告', '禁词', '概念创意'], outputType: 'text', inspiredBy: ['arena-hard'],
      prompt: '为一家“能退回一句说出口的话”的商店写 150–220 字广告。不得出现“后悔、时间、记忆、梦”四个词，也不要解释技术原理。结尾必须是一句风险警告，而不是购买号召。',
    },
    {
      id: 'creative-server-dialogue', title: '机房里的十二句', category: '创意表达',
      summary: '只靠短对话完成冲突升级与行动收束。', tags: ['对话', '约束写作', '机房'], outputType: 'text', inspiredBy: ['mt-bench', 'arena-hard'],
      prompt: '只写 12 行对话，不要旁白。人物是两名值班工程师，他们正在争论是否重启支付服务；每行不超过 16 个汉字。前 6 行冲突升级，后 6 行形成行动方案。“回滚”和“重启”各出现且只出现一次，禁用“我觉得”。',
    },
    {
      id: 'reasoning-talk-order', title: '四场分享的唯一顺序', category: '推理判断',
      summary: '从相邻、位置与先后约束推出唯一排程。', tags: ['排程', '逻辑', '唯一解'], outputType: 'text', inspiredBy: ['bigbench', 'livebench'],
      prompt: '四场分享依次在 9:00、9:30、10:00、10:30 开始，讲者是吴、周、林、梅。梅紧接在林之后；周既不是第一位也不是最后一位；吴在梅之前。请给出唯一顺序，并用不超过 120 字说明排除过程。',
    },
    {
      id: 'reasoning-two-true', title: '恰好两句是真的', category: '推理判断',
      summary: '检验真假命题枚举和逐项验证能力。', tags: ['真假命题', '枚举', '密码'], outputType: 'text', inspiredBy: ['bigbench', 'bbeh'],
      prompt: '密码是 1–9 中的一个整数。以下四句话恰好两句为真：A. 密码是偶数；B. 密码大于 5；C. 密码能被 3 整除；D. 密码是 8。求密码，并逐句标出真/假。',
    },
    {
      id: 'reasoning-coffee-cause', title: '音乐让销量翻倍了吗', category: '推理判断',
      summary: '识别混杂因素并给出低成本因果验证方案。', tags: ['因果', '实验设计', '混杂因素'], outputType: 'text', inspiredBy: ['bigbench', 'livebench'],
      prompt: '咖啡店周五换了背景音乐，当天销量比上周五高 42%。同一天还下雨、发了九折券，附近竞品停电。判断“音乐提升销量”是否成立；列出至少 3 个混杂因素，再设计一个成本最低、两周内可执行的验证方案。',
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
      prompt: '只输出合法 JSON 数组，不要代码围栏。数组恰好 3 项，每项 keys 必须按 id、status、owner 顺序出现；id 依次为 1、2、3；status 分别且仅使用一次 pending、doing、done；owner 是 2–3 个汉字。',
    },
    {
      id: 'instruction-table-total', title: '只给一张结算表', category: '指令遵循',
      summary: '格式约束和基础计算必须同时正确。', tags: ['Markdown', '表格', '计算'], outputType: 'text', inspiredBy: ['ifeval'],
      prompt: '只输出 Markdown 表格，不要表格外文字。列为“项目｜单价｜数量｜小计”；数据为 A=120×2、B=85×3、C=50×4；最后一行项目写“合计”，其余不适用单元格写“-”，小计填正确总额。表头后恰好 4 行。',
    },
    {
      id: 'instruction-two-paragraphs', title: '两段话的停止条件', category: '指令遵循',
      summary: '约束段落、句数、字数、禁词与固定结尾。', tags: ['段落', '禁词', '固定结尾'], outputType: 'text', inspiredBy: ['ifeval'],
      prompt: '回答“什么时候应该停止优化一个小工具？”。必须恰好两段：第一段恰好 2 句，第二段恰好 1 句；全文 90–120 个汉字；禁用“首先、其次、最后”；全文最后一句必须完全等于“能用且可维护，就够用。”',
    },
    {
      id: 'code-merge-ranges', title: '合并时间区间', category: '编码调试',
      summary: '用边界条件和断言验证 Python 实现完整度。', tags: ['Python', '区间', '边界'], outputType: 'text', inspiredBy: ['humaneval', 'bigcodebench'],
      prompt: '用 Python 实现 `merge_ranges(ranges)`：输入是顺序任意的 `[start,end]` 列表，输出按 start 升序的合并结果；重叠或首尾相接都要合并；不得修改输入；任一 start>end 时抛 `ValueError`。只输出完整代码，并附 5 个 assert，覆盖空输入、乱序、相接、包含和非法区间。',
    },
    {
      id: 'code-lru-map', title: 'O(1) 的 LRU 缓存', category: '编码调试',
      summary: '检验 Map 顺序语义、复杂度与容量边界。', tags: ['JavaScript', 'LRU', '数据结构'], outputType: 'text', inspiredBy: ['humaneval', 'bigcodebench'],
      prompt: '用 JavaScript 实现 `class LRUCache`，构造参数 capacity 必须为正整数；`get(key)` 不存在返回 -1，存在则更新最近使用顺序；`put(key,value)` 插入或更新，超限淘汰最久未用项。要求 get/put 平均 O(1)，可使用 Map。只输出代码，包含 capacity=1 的演示。',
    },
    {
      id: 'code-async-order', title: 'forEach 异步陷阱', category: '编码调试',
      summary: '修复异步等待、输入顺序与单项容错问题。', tags: ['JavaScript', '异步', 'Debug'], outputType: 'text', inspiredBy: ['bigcodebench', 'mt-bench'],
      prompt: '修复以下代码，使它等待全部请求、保持 ids 输入顺序，并把单项失败保存为 `{id,error}` 而不是让整批失败：\n```js\nasync function load(ids) {\n  const out = [];\n  ids.forEach(async id => out.push(await fetchOne(id)));\n  return out;\n}\n```\n先用恰好 2 句解释根因，再给最小修改后的完整函数。',
    },
    {
      id: 'code-csv-line', title: '一行 CSV 解析器', category: '编码调试',
      summary: '不用库处理引号、转义、空字段与异常输入。', tags: ['JavaScript', 'CSV', '解析器'], outputType: 'text', inspiredBy: ['humaneval', 'bigcodebench'],
      prompt: '不用第三方库，实现 `parseCsvLine(line)`：支持逗号分隔、双引号包裹的字段、字段内逗号、连续两个双引号表示一个引号、空字段；未闭合引号要抛错。只输出 JavaScript 代码，并给出至少 6 个测试用例。',
    },
    {
      id: 'web-focus-timer', title: '专注计时器', category: '网页交互',
      summary: '计时状态、键盘操作、进度动画与无障碍一题覆盖。', tags: ['计时', '无障碍', '键盘'], outputType: 'html', inspiredBy: ['artifactsbench', 'webdev-arena'],
      prompt: '生成一个完整单文件 HTML 专注计时器：25 分钟专注 / 5 分钟休息，可开始、暂停、重置；Space 切换开始暂停，R 重置；圆环显示进度，页面标题同步剩余时间；按钮有可访问名称；支持 `prefers-reduced-motion`；禁止外部依赖，中文界面。',
    },
    {
      id: 'web-bill-splitter', title: '聚餐分账器', category: '网页交互',
      summary: '测试表单校验、实时计算、复制反馈和响应式。', tags: ['表单', '计算', '复制'], outputType: 'html', inspiredBy: ['artifactsbench', 'webdev-arena'],
      prompt: '生成一个完整单文件 HTML 聚餐分账器：输入账单总额、人数、小费比例，实时显示总计与每人应付；处理空值、负数、人数为 0；提供“复制结算摘要”按钮和成功反馈；键盘可完成全部操作；窄屏不横向滚动；中文界面，无外部依赖。',
    },
    {
      id: 'web-departure-board', title: '城市发车牌', category: '网页交互',
      summary: '检验有机数据、搜索筛选、空态与双端布局。', tags: ['搜索', '筛选', '响应式'], outputType: 'html', inspiredBy: ['artifactsbench', 'webdev-arena'],
      prompt: '生成一个完整单文件 HTML 城市列车发车牌。内置 6 条有机数据（时间、车次、目的地、站台、状态），按时间排序；支持搜索目的地和筛选“准点/晚点/检票”；无结果时有可恢复空态；桌面表格、窄屏卡片；中文界面，无外部依赖。',
    },
    {
      id: 'web-memory-grid', title: '几何记忆翻牌', category: '网页交互',
      summary: '完整小游戏状态机，兼顾键盘与窄屏可玩性。', tags: ['小游戏', '键盘', '状态机'], outputType: 'html', inspiredBy: ['artifactsbench', 'webdev-arena'],
      prompt: '生成一个完整单文件 HTML 4×4 记忆翻牌游戏，使用 8 对纯 CSS 几何图形，不用 emoji 或图片。记录步数和用时，匹配成功保持翻开，全部完成显示自定义胜利层，可重新开始；卡片支持 Tab、Enter、Space；窄屏可玩，无外部依赖。',
    },
    {
      id: 'svg-rube-machine', title: '鲁布·戈德堡装置', category: 'SVG 视觉',
      summary: '多段因果动作需要清晰编排成无缝 SVG 循环。', tags: ['SVG', '动画', '时序'], outputType: 'html', inspiredBy: ['svgenius', 'artifactsbench'],
      prompt: '只输出一个完整 standalone SVG，viewBox=`0 0 800 500`。画一台鲁布·戈德堡装置：小球滚下斜坡、撞倒骨牌、压下杠杆、最终敲响铃；动作因果顺序清楚，8 秒无缝循环；不使用 JavaScript 或外部资源；包含 `<title>`、`<desc>` 和 reduced-motion 静止态。',
    },
    {
      id: 'svg-isometric-bookshop', title: '等距深夜书店', category: 'SVG 视觉',
      summary: '用冷暖关系、等距几何和细节层级测试视觉表达。', tags: ['SVG', '等距插画', '细节'], outputType: 'html', inspiredBy: ['svgenius', 'artifactsbench'],
      prompt: '只输出一个完整 standalone SVG，viewBox=`0 0 800 600`。画一间等距视角的深夜小书店：三排书架、梯子、收银台、窗外细雨和一只躲在桌下的猫；暖内光、冷外景，细节清楚但不过度堆砌；窗口 hover 时灯光轻微变化；包含 `<title>` 与 `<desc>`，无外部资源。',
    },
    {
      id: 'svg-rainfall-poster', title: '七日降雨数据海报', category: 'SVG 视觉',
      summary: '把精确数据、刻度和主题插画组合成可读海报。', tags: ['SVG', '图表', '信息设计'], outputType: 'html', inspiredBy: ['svgenius', 'artifactsbench'],
      prompt: '只输出一个完整 standalone SVG，viewBox=`0 0 900 560`。把周一至周日降雨量 `[12,28,7,45,31,18,39]` mm 做成数据海报：必须有精确刻度、每柱数值、中文星期标签、平均值参考线和一处云雨主题插画；浅色、可读、响应式；包含 `<title>` 与 `<desc>`，无外部资源。',
    },
    {
      id: 'svg-day-night-badge', title: '昼夜循环徽章', category: 'SVG 视觉',
      summary: '测试形状、色彩状态和无缝动画循环。', tags: ['SVG', '徽章', '循环动画'], outputType: 'html', inspiredBy: ['svgenius', 'artifactsbench'],
      prompt: '只输出一个完整 standalone SVG，viewBox=`0 0 600 600`。设计一枚圆形昼夜徽章：太阳沿弧线落下，月亮升起，天空与城市剪影随之变色；10 秒无缝循环；文字仅“昼 / 夜”；不使用 JavaScript 或外部资源；包含 `<title>`、`<desc>` 和 reduced-motion 静止态。',
    },
    {
      id: 'role-outage-audiences', title: '同一故障，三种受众', category: '角色风格',
      summary: '在事实不变时为管理者、客户和工程师切换表达。', tags: ['受众适配', '事实守恒', '故障'], outputType: 'text', inspiredBy: ['mt-bench', 'arena-hard'],
      prompt: '事实只有这些：支付 API 在 14:10–14:37 部分故障，18% 请求失败，重试后恢复；无数据丢失；根因是数据库连接池配置，已回滚。分别写给：①CEO（≤80 字）；②客户状态页（80–120 字）；③新入职工程师（120–180 字）。不得新增赔偿、责任人或未给出的技术细节。',
    },
    {
      id: 'role-socratic-fraction', title: '不直接报答案的数学导师', category: '角色风格',
      summary: '用有限个递进问题引导学生自行纠错。', tags: ['苏格拉底', '教学', '分数'], outputType: 'text', inspiredBy: ['mt-bench'],
      prompt: '学生说：“3/4 + 1/6 = 4/10。”你是苏格拉底式数学导师。只用最多 4 个递进问题引导他自行发现问题，不直接给正确答案，不说“你错了”，不要夸奖式套话；第一个问题必须指向“分母能否直接相加”。',
    },
    {
      id: 'role-line-editor', title: '冷静但不刻薄的编辑', category: '角色风格',
      summary: '要求精确诊断冗长句，同时保持对作者的尊重。', tags: ['编辑', '改写', '批评'], outputType: 'text', inspiredBy: ['arena-hard', 'mt-bench'],
      prompt: '你是严厉但尊重作者的句子编辑。原句：“在当前复杂多变且充满不确定性的市场环境背景之下，我们需要进一步持续不断地加强对于用户真实核心需求层面的深入洞察。”输出固定三部分：①诊断 3 条；②50 字以内改写；③保留与删除理由各 1 条。批评文字，不评价作者。',
    },
    {
      id: 'role-launch-mediator', title: '明天演示，今天怎么收口', category: '角色风格',
      summary: '从立场深入利益，给出有时间盒和验收线的调解方案。', tags: ['调解', '决策', '验收'], outputType: 'text', inspiredBy: ['arena-hard', 'mt-bench'],
      prompt: '设计师要求像素完美，工程师要求今天上线；明天有客户演示，预算不允许加班。你是调解人：先分别写出双方“立场/真实利益”，再给一个 30 分钟会议议程，最后提出可在今天验收的折中方案和 4 条验收标准。不要用“双方都有道理”糊弄。',
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
      id: 'data-latest-phone', title: '噪声订单取最终字段', category: '数据结构化',
      summary: '从更新记录中消解冲突并严格输出 JSON。', tags: ['抽取', '冲突消解', 'JSON'], outputType: 'text', inspiredBy: ['livebench', 'bigbench'],
      prompt: '从材料中提取最终信息，只输出合法 JSON：\n“订单 QM-0711；收件人：林予安；电话 138 0013 8000；金额￥248.60。2026-07-12 备注：电话改为 13800138001；客服确认旧号码已作废。”\nkeys 固定为 orderId、recipient、phone、amount、phoneUpdatedAt；amount 为数字，日期用 YYYY-MM-DD。',
    },
    {
      id: 'data-weighted-ranking', title: '两模型加权排名', category: '数据结构化',
      summary: '检验加权计算、舍入、排序和固定 JSON 结构。', tags: ['加权计算', '排名', 'JSON'], outputType: 'text', inspiredBy: ['livebench', 'bigbench'],
      prompt: '质量权重 0.5、速度权重 0.3、成本权重 0.2。模型 A 得分为质量 86、速度 72、成本 90；模型 B 为质量 82、速度 88、成本 76。计算一位小数的加权总分并排名。只输出 JSON：`{"ranking":[{"model":"…","score":0.0}],"winner":"…"}`。',
    },
    {
      id: 'data-contact-dedupe', title: '联系人去重合并', category: '数据结构化',
      summary: '按多条规范化规则合并时序联系人数据。', tags: ['去重', '规范化', '合并'], outputType: 'text', inspiredBy: ['livebench', 'bigbench'],
      prompt: '按 email 忽略大小写去重；电话去掉空格和连字符；同一人保留日期最新的非空姓名与电话。输入：\n2026-07-01,乔木,joe@example.com,138-0013-8000\n2026-07-09,Xiangyang Qiaomu,JOE@example.com,13800138001\n2026-07-06,林舟,lin@example.com,\n只输出 JSON 数组，keys 为 name、email、phone、updatedAt；缺失电话用 null。',
    },
    {
      id: 'data-calendar-ics', title: '两条日程转 iCalendar', category: '数据结构化',
      summary: '严格转换时区、重复规则与固定标识字段。', tags: ['iCalendar', '时区', '格式转换'], outputType: 'text', inspiredBy: ['livebench', 'bigbench'],
      prompt: '把以下日程转成有效 iCalendar 文本：①2026-08-03 09:30–10:00 起，每周一例会，共 4 次；②2026-08-14 14:00–15:30 发布复盘。时区 `Asia/Shanghai`；UID 固定为 `weekly@qiaomu.ai` 与 `retro@qiaomu.ai`；DTSTAMP 固定为 `20260711T080000Z`。只输出完整 VCALENDAR，不要代码围栏。',
    },
  ];

  window.CB_PROMPT_LIBRARY = Object.freeze(
    cases.map((item) => Object.freeze({ ...item, tags: Object.freeze(item.tags), inspiredBy: Object.freeze(item.inspiredBy) }))
  );
})();
