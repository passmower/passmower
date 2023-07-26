import usernameBlacklist from "./username-blacklist.js";
import Account from "./account.js";
import koaValidator from "koa-async-validator";

export default koaValidator({
    customValidators: {
        startsWithLetter: (value) => (new RegExp('^[a-z].*')).test(value),
        isBlackListed: (value) => usernameBlacklist(value),
        usernameExists: (value, ctx) => new Promise((resolve, reject) => {
            if (!value) {
                resolve(true) // We don't want to display that username is taken if it's null
            } else {
                Account.findAccount(ctx, value).then(user => {
                    resolve(!user)
                }).catch(reject);
            }
        })
    }
})

export function checkUsername(ctx) {
    ctx.checkBody('username', 'Username must be 2-15 characters').isLength({min: 2, max: 15})
    ctx.checkBody('username', 'Username must be alphanumeric').isAlphanumeric()
    ctx.checkBody('username', 'Prohibited username').isBlackListed()
    ctx.checkBody('username', 'Username must start with a letter').startsWithLetter()
    ctx.checkBody('username', 'Username is taken').usernameExists()
    ctx.checkBody('username', 'Username must be lowercase').isLowercase()
}

export function checkEmail(ctx) {
    ctx.checkBody('email', 'Incorrent email').isEmail()
}
