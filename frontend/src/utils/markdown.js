import MarkdownIt from 'markdown-it';
import markdownItKatex from 'markdown-it-katex';

const normalizeMathSegment = (segment) => {
  const text = String(segment || '');
  if (!text) {
    return '';
  }

  return text
    .replace(/\\([a-zA-Z]+)\s+\{/g, '\\$1{')
    .replace(/\{\s+/g, '{')
    .replace(/\s+\}/g, '}')
    .replace(/\^\s+\{/g, '^{')
    .replace(/_\s+\{/g, '_{')
    .replace(/([A-Za-z0-9])\s+(?=[A-Za-z0-9])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const normalizeMathDelimiters = (content) => {
  const text = String(content || '');
  if (!text) {
    return '';
  }

  const normalized = text
    .replace(/\\\$/g, '$')
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$')
    .replace(/\\\[/g, '$$')
    .replace(/\\\]/g, '$$');

  return normalized.replace(/\$\$([\s\S]*?)\$\$|\$([^\$\n]+?)\$/g, (match, blockMath, inlineMath) => {
    const body = String(blockMath || inlineMath || '');
    if (!body) {
      return match;
    }

    const wrapped = match.startsWith('$$') && match.endsWith('$$');
    const cleaned = normalizeMathSegment(body);
    return wrapped ? `$$${cleaned}$$` : `$${cleaned}$`;
  });
};

export const createMarkdownRenderer = (opts = {}) => {
  const md = new MarkdownIt({ html: false, breaks: true, linkify: true });
  md.use(markdownItKatex);

  return {
    md,
    render(content) {
      const normalized = normalizeMathDelimiters(content);
      return md.render(String(normalized || ''));
    },
    ...opts
  };
};
