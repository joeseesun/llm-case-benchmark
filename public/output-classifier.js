/* Shared browser/server classifier for deciding whether model output is a renderable artifact. */
(function initOutputClassifier(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CB_OUTPUT_CLASSIFIER = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const ARTIFACT_LANGUAGES = new Set(['html', 'xhtml', 'svg', 'xml']);
  const MIN_ARTIFACT_COVERAGE = 0.72;
  const MAX_WRAPPER_CHARS = 220;
  const MAX_WRAPPER_LINES = 4;

  function hasStrongArtifactIntent(input = {}) {
    const prompt = `${input.title || ''}\n${input.prompt || ''}`.trim();
    if (!prompt) return false;
    const chineseIntent = /(?:画|绘制|生成|创建|制作|实现|输出|编写|写出|开发|搭建|做)(?:一|个|张|幅|套|份|段|出|成|一个|一张)?[^\n，。；:：]{0,24}(?:svg|html|网页|页面|网站|canvas|webgl)/i;
    const englishIntent = /(?:draw|generate|create|build|implement|output|write|make|develop)[^\n.!?]{0,48}(?:svg|html|web\s?page|website|canvas|webgl)/i;
    const intentMatches = [chineseIntent.exec(prompt), englishIntent.exec(prompt)].filter(Boolean);
    if (!intentMatches.length) return false;
    const intent = intentMatches.sort((left, right) => left.index - right.index)[0];
    const artifactOffset = intent[0].search(/svg|html|网页|页面|网站|canvas|webgl|web\s?page|website/i);
    const artifactIndex = intent.index + Math.max(0, artifactOffset);
    const explanatory = /解释|分析|比较|对比|区别|教程|原理|是什么|为什么|建议|审查|评审|explain|analy[sz]e|compare|tutorial|review|audit|describe/i.exec(prompt);
    return !explanatory || explanatory.index > artifactIndex;
  }

  function inferRequestedOutputType(input = {}) {
    const explicit = input.outputType ?? input.output_type;
    if (explicit === 'html') return 'html';
    const category = String(input.category || '').toLowerCase();
    const strongArtifactIntent = hasStrongArtifactIntent(input);
    if (explicit === 'text') {
      return category === 'frontend' && strongArtifactIntent ? 'html' : 'text';
    }
    if (category === 'frontend' || strongArtifactIntent) return 'html';
    return 'text';
  }

  function decodeArtifactEntities(text) {
    return String(text || '')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&#x27;/gi, "'")
      .replace(/&amp;/gi, '&');
  }

  function matchCompleteHtml(text) {
    const match = /(?:<!doctype\s+html[^>]*>\s*)?<html[\s>][\s\S]*?<\/html\s*>/i.exec(text);
    if (!match || !/<(?:head|body|main|section|article|div|canvas|svg|style|script)[\s>]/i.test(match[0])) {
      return null;
    }
    return { kind: 'html', source: match[0].trim(), start: match.index, end: match.index + match[0].length };
  }

  function matchCompleteSvg(text) {
    const matches = [...text.matchAll(/<svg[\s>][\s\S]*?<\/svg\s*>/gi)];
    if (matches.length !== 1) return null;
    const match = matches[0];
    if (!/<(?:path|rect|circle|ellipse|line|polyline|polygon|text|image|g|use|foreignObject|animate|animateTransform)[\s>]/i.test(match[0])) {
      return null;
    }
    return { kind: 'svg', source: match[0].trim(), start: match.index, end: match.index + match[0].length };
  }

  function trimIncompleteMarkupTail(source) {
    let repaired = String(source || '').replace(/\n?```[\s\S]*$/g, '').trim();
    const lastOpenComment = repaired.lastIndexOf('<!--');
    const lastCloseComment = repaired.lastIndexOf('-->');
    if (lastOpenComment > lastCloseComment) repaired = repaired.slice(0, lastOpenComment).trim();

    for (const tag of ['script', 'style']) {
      const opens = [...repaired.matchAll(new RegExp(`<${tag}[\\s>]`, 'gi'))].length;
      const closes = [...repaired.matchAll(new RegExp(`</${tag}\\s*>`, 'gi'))].length;
      if (opens > closes) repaired = repaired.slice(0, repaired.toLowerCase().lastIndexOf(`<${tag}`)).trim();
    }

    const lastLt = repaired.lastIndexOf('<');
    const lastGt = repaired.lastIndexOf('>');
    if (lastLt > lastGt) repaired = repaired.slice(0, lastLt).trim();
    return repaired;
  }

  function matchRecoverableSvg(text) {
    if (/<\/svg\s*>/i.test(text)) return null;
    const starts = [...text.matchAll(/<svg[\s>]/gi)];
    if (starts.length !== 1) return null;
    const start = starts[0].index;
    const source = trimIncompleteMarkupTail(text.slice(start));
    if (source.length < 160 || !/^<svg[\s>]/i.test(source) || !source.includes('>')) return null;
    if (!/<(?:path|rect|circle|ellipse|line|polyline|polygon|text|image|g|use|foreignObject|animate|animateTransform)[\s>]/i.test(source)) {
      return null;
    }
    return {
      kind: 'svg',
      source: `${source}\n</svg>`,
      start,
      end: text.length,
      recovered: true,
    };
  }

  function matchRecoverableHtml(text) {
    if (/<\/html\s*>/i.test(text)) return null;
    const starts = [...text.matchAll(/<!doctype\s+html[^>]*>|<html[\s>]/gi)];
    if (!starts.length || starts.filter((match) => /^<html/i.test(match[0])).length > 1) return null;
    const start = starts[0].index;
    let source = trimIncompleteMarkupTail(text.slice(start));
    if (source.length < 300 || !/<html[\s>]/i.test(source) || !/<body[\s>]/i.test(source)) return null;
    if (!/<(?:main|section|article|div|canvas|svg|style)[\s>]/i.test(source)) return null;
    if (/<svg[\s>]/i.test(source) && !/<\/svg\s*>/i.test(source)) source += '\n</svg>';
    if (!/<\/body\s*>/i.test(source)) source += '\n</body>';
    source += '\n</html>';
    return { kind: 'html', source, start, end: text.length, recovered: true };
  }

  function matchArtifact(text) {
    return matchCompleteHtml(text) || matchCompleteSvg(text);
  }

  function fencedArtifact(text) {
    const fenceRe = /```([\w+-]*)[^\n]*\n([\s\S]*?)\n```/g;
    const candidates = [];
    let match;
    while ((match = fenceRe.exec(text))) {
      const language = String(match[1] || '').toLowerCase();
      const artifact = matchArtifact(String(match[2] || '').trim());
      if (!artifact) continue;
      if (language && !ARTIFACT_LANGUAGES.has(language)) continue;
      candidates.push({
        ...artifact,
        fenced: true,
        language,
        containerStart: match.index,
        containerEnd: match.index + match[0].length,
      });
    }
    return candidates.length === 1 ? candidates[0] : null;
  }

  function directArtifact(text) {
    const html = matchCompleteHtml(text);
    if (html) return { ...html, fenced: false, containerStart: html.start, containerEnd: html.end };
    const partialHtml = matchRecoverableHtml(text);
    if (partialHtml) {
      return { ...partialHtml, fenced: false, containerStart: partialHtml.start, containerEnd: partialHtml.end };
    }
    const svg = matchCompleteSvg(text) || matchRecoverableSvg(text);
    return svg ? { ...svg, fenced: false, containerStart: svg.start, containerEnd: svg.end } : null;
  }

  function classifyModelOutput(content) {
    const raw = decodeArtifactEntities(content).trim();
    if (!raw) return { kind: 'markdown', source: '', confidence: 1, reason: 'empty' };

    const candidate = fencedArtifact(raw) || directArtifact(raw);
    if (!candidate) {
      return { kind: 'markdown', source: raw, confidence: 1, reason: 'no-complete-artifact' };
    }

    const wrapper = `${raw.slice(0, candidate.containerStart)}\n${raw.slice(candidate.containerEnd)}`.trim();
    const wrapperLines = wrapper ? wrapper.split(/\r?\n/).filter((line) => line.trim()).length : 0;
    const coverage = candidate.source.length / Math.max(1, raw.length);
    const conciseWrapper = wrapper.length <= MAX_WRAPPER_CHARS && wrapperLines <= MAX_WRAPPER_LINES;
    const dominantArtifact = coverage >= MIN_ARTIFACT_COVERAGE;

    if (!dominantArtifact && !conciseWrapper) {
      return {
        kind: 'markdown',
        source: raw,
        confidence: 0.9,
        reason: 'mixed-markdown-and-artifact',
        coverage,
      };
    }

    return {
      kind: candidate.kind,
      source: candidate.source,
      confidence: candidate.recovered ? 0.88 : dominantArtifact ? 0.99 : 0.94,
      reason: candidate.recovered
        ? `recoverable-partial-${candidate.kind}`
        : candidate.fenced
          ? 'single-artifact-fence'
          : 'standalone-artifact',
      coverage,
      recovered: !!candidate.recovered,
    };
  }

  return Object.freeze({ classifyModelOutput, hasStrongArtifactIntent, inferRequestedOutputType });
});
