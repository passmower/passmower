import {existsSync, readFileSync, statSync} from 'fs';
import htmlSafe from "oidc-provider/lib/helpers/html_safe.js";
import { Marked } from 'marked';

export const ApprovalTextName = 'approval'
export const ToSTextName = 'tos'

const configuredTextCache = new Map()

export const clearConfiguredTextCache = () => configuredTextCache.clear()

export function getConfiguredText(name) {
    const markdownPath = `/app/${name}/${name}.md`
    const textPath = `/app/${name}/${name}.txt`
    const path = existsSync(markdownPath) ? markdownPath : existsSync(textPath) ? textPath : null
    if (!path) return null
    const stat = statSync(path)
    const cacheKey = `${path}:${stat.mtimeMs}:${stat.size}`
    const cached = configuredTextCache.get(name)
    if (cached?.key === cacheKey) return cached.text

    let text
    if (path === markdownPath) {
        const marked = new Marked({
            mangle: false,
            headerIds: false,
            pedantic: false,
            gfm: true,
            // breaks: true, // Doesn't work: https://github.com/markedjs/marked/issues/2842
        })
        marked.use({ renderer });
        text = readFileSync(path, {
            encoding: 'utf-8'
        })
        text = text.replace(/\n(?=\n)/g, "\n<br><br>");
        text = marked.parse(text)
    } else {
        text = readFileSync(path, 'utf8');
        if (!text.trim()) {
            configuredTextCache.set(name, {key: cacheKey, text: null})
            return null
        }
        text = htmlSafe(text)
        text = text.replace(/\n/g, '<br/>')
    }

    text = text?.trim() ? text : null
    configuredTextCache.set(name, {key: cacheKey, text})
    return text
}

export function getText(name) {
    const text = getConfiguredText(name)
    if (text !== null) return text
    // Preserve the existing behavior for optional non-ToS text mounts: an
    // explicitly empty file renders as empty rather than as setup guidance.
    if (existsSync(`/app/${name}/${name}.md`) || existsSync(`/app/${name}/${name}.txt`)) return ''
    return `Please add /app/${name}/${name}.{md|txt} using ConfigMap.`
}

export function getTermsOfService() {
    return getConfiguredText(ToSTextName)
}

const renderer = {
    // marked v5+ passes a token object; the link text is rendered from its
    // child tokens via the bound parser.
    link({ href, tokens }) {
        return `<a target="_blank" href="${href}">${this.parser.parseInline(tokens)}</a>`;
    }
};
