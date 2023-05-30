import {existsSync, readFileSync} from 'fs';
import htmlSafe from "oidc-provider/lib/helpers/html_safe.js";

export const ApprovalTextName = 'approval'
export const ToSTextName = 'tos'

export function getText(name) {
    let text = `Please add /app/${name}/${name}.txt using ConfigMap.`
    if (existsSync(`/app/${name}/${name}.txt`)) {
        text = readFileSync(`/app/${name}/${name}.txt`, 'utf8');
    }
    text = htmlSafe(text)
    return text.replace(/\n/g, '<br/>')
}
