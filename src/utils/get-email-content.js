import {dirname} from "desm";
// ejs 6 is CommonJS and only exposes renderFile on its default export
// (no named ESM export), so import the default and destructure.
import ejs from "ejs";
import path from "path";
import fs from "fs";

const {renderFile} = ejs;

export const getEmailContent = async (template, variables) => {
    return {
        html: await renderFile(getTemplatePath(template, '.ejs'), variables),
        text: await renderFile(getTemplatePath(template, '.txt'), variables),
    }
}

export const getEmailSubject = (template) => {
    const path = getTemplatePath(template, '.subject')
    return fs.readFileSync(path, 'utf8')
}

const getTemplatePath = (template, extension) => {
    let basePath = dirname(import.meta.url);
    basePath = path.join(basePath, '..', 'views')
    let templateFile = template + extension
    return fs.existsSync(path.join(basePath, 'custom', templateFile)) ? path.join(basePath, 'custom', templateFile) : path.join(basePath, templateFile)
}
