import {existsSync, readFileSync} from 'fs';

export const ApprovalTextName = 'approval'
export const ToSTextName = 'tos'

export function getText(name) {
    let text = ''
    if (existsSync(`/app/${name}/${name}.txt`)) {
        text = readFileSync(`/app/${name}/${name}.txt`, 'utf8');
    }
    return text.replace(/\n/g, '<br/>')
}
