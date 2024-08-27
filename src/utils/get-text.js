import {existsSync, readFileSync} from 'fs';
import htmlSafe from "oidc-provider/lib/helpers/html_safe.js";
import { Marked } from 'marked';

export const ApprovalTextName = 'approval'
export const ToSTextName = 'tos'

export function getText(name) {
    let text = `Please add /app/${name}/${name}.{md|txt} using ConfigMap.`
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
        text = htmlSafe(text)
        text.replace(/\n/g, '<br/>')
    }

    return text
}

const renderer = {
    link(href, title, text) {
        return `<a target="_blank" href="${href}">${text}</a>`;
    }
};
