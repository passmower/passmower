import {existsSync, readFileSync} from 'fs';
import htmlSafe from "oidc-provider/lib/helpers/html_safe.js";
import { Marked } from 'marked';

export const ApprovalTextName = 'approval'
export const ToSTextName = 'tos'

export function getConfiguredText(name) {
    let text
    if (existsSync(`/app/${name}/${name}.md`)) {
        const marked = new Marked({
            mangle: false,
            headerIds: false,
            pedantic: false,
            gfm: true,
            // breaks: true, // Doesn't work: https://github.com/markedjs/marked/issues/2842
        })
        marked.use({ renderer });
        text = readFileSync(`/app/${name}/${name}.md`, {
            encoding: 'utf-8'
        })
        text = text.replace(/\n(?=\n)/g, "\n<br><br>");
        text = marked.parse(text)
    } else if (existsSync(`/app/${name}/${name}.txt`)) {
        text = readFileSync(`/app/${name}/${name}.txt`, 'utf8');
        if (!text.trim()) return null
        text = htmlSafe(text)
        text = text.replace(/\n/g, '<br/>')
    } else {
        return null
    }

    return text?.trim() ? text : null
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
