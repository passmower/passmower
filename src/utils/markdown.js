import htmlSafe from "oidc-provider/lib/helpers/html_safe.js";
import { Marked } from 'marked';

// Only allow links to navigable, non-script schemes.
const SAFE_HREF = /^(https?:|mailto:|\/)/i;

const renderer = {
    // Open links in a new tab and reject script-y URL schemes.
    link(href, title, text) {
        const safe = href && SAFE_HREF.test(href.trim()) ? href : '#';
        return `<a target="_blank" rel="noreferrer noopener" href="${htmlSafe(safe)}">${text}</a>`;
    },
    // Neutralise any raw HTML embedded in the markdown source (block + inline),
    // so rendering the result with v-html can't inject markup/scripts.
    html(html) {
        return htmlSafe(html);
    },
};

const marked = new Marked({
    mangle: false,
    headerIds: false,
    pedantic: false,
    gfm: true,
});
marked.use({ renderer });

// Render untrusted Markdown to sanitized HTML. Regular text is escaped by
// marked itself; raw HTML and unsafe link schemes are neutralised above.
export const renderMarkdown = (text) => {
    if (!text) {
        return null;
    }
    return marked.parse(String(text)).trim();
};
