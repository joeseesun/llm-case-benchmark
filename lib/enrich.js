'use strict';

/**
 * Auto-complete case metadata from a raw prompt via OpenAI-compatible chat API.
 * Used when users only paste a Prompt on submit.
 */

async function enrichCaseFromPrompt({ prompt, callChatCompletions, credentials }) {
  if (!credentials?.apiKey || !credentials?.baseUrl) {
    return null;
  }
  const model = credentials.model || 'deepseek-v4-flash';
  const system = `你是题库编辑。用户只给了一段评测 Prompt，请推断补全题库字段。
只输出一个 JSON 对象（不要 Markdown 围栏），字段：
{
  "title": "中文短标题≤24字",
  "summary": "一句话摘要≤40字",
  "category": "creative-writing 或 frontend",
  "difficulty": "easy|medium|hard",
  "tags": ["标签1","标签2"],
  "system": "给模型的 system 提示（可空字符串）",
  "rubric": ["评分点1","评分点2","评分点3"],
  "outputType": "text 或 html"
}
规则：
- 若 Prompt 要求输出完整 HTML/网页/Three.js/Canvas，outputType=html，category=frontend
- 否则 outputType=text；写作/文案/推理类用 creative-writing
- system 要短、可执行
- tags 2～4 个`;

  const out = await callChatCompletions({
    baseUrl: credentials.baseUrl,
    apiKey: credentials.apiKey,
    model,
    system,
    prompt: `用户 Prompt 如下：\n---\n${String(prompt).slice(0, 8000)}\n---`,
    temperature: 0.3,
    maxTokens: 800,
  });

  let text = String(out.content || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const data = JSON.parse(text);
  const category =
    data.category === 'frontend' || data.category === 'creative-writing'
      ? data.category
      : /html|网页|three|canvas|css|前端/i.test(prompt)
        ? 'frontend'
        : 'creative-writing';
  return {
    title: String(data.title || '未命名题目').slice(0, 80),
    summary: String(data.summary || '').slice(0, 200),
    category,
    difficulty: ['easy', 'medium', 'hard'].includes(data.difficulty) ? data.difficulty : 'medium',
    tags: Array.isArray(data.tags) ? data.tags.map(String).slice(0, 6) : [],
    system: String(data.system || '').slice(0, 4000),
    rubric: Array.isArray(data.rubric) ? data.rubric.map(String).slice(0, 8) : [],
    outputType: data.outputType === 'html' || category === 'frontend' ? 'html' : 'text',
    enrichedBy: model,
  };
}

module.exports = { enrichCaseFromPrompt };
