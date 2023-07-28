import usernameBlacklist from "./username-blacklist.js";
import Account from "./account.js";
import koaValidator from "koa-async-validator";
import validator from "validator";

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
        }),
        usernameNotExists: (value, ctx) => new Promise((resolve, reject) => {
            if (!value) {
                resolve(true) // We don't want to display that username is taken if it's null
            } else {
                Account.findAccount(ctx, value).then(user => {
                    resolve(user)
                }).catch(reject);
            }
        }),
        emailExists: (value, ctx) => new Promise((resolve, reject) => {
            if (!value) {
                resolve(true) // We don't want to display that email is taken if it's null
            } else {
                Account.findByEmail(ctx, value).then(user => {
                    resolve(!user)
                }).catch(reject);
            }
        }),
        isValidName: (value) => validator.isAlphanumeric(value, 'en-US', {
            ignore: ' ÜÕÖÄüõöä'
        }),
        isValidCompanyName: (value) => validator.isAlphanumeric(value, 'en-US', {
            ignore: ' ÜÕÖÄüõöä'
        })
    }
})

export async function restValidationErrors(ctx)
{
    let errors = await ctx.validationErrors()
    if (errors) {
        ctx.status = 400
        ctx.body = {
            errors
        }
        return true
    }
    return false
}

export function checkUsername(ctx) {
    ctx.checkBody('username', 'Username must be 2-15 characters').isLength({min: 2, max: 15})
    ctx.checkBody('username', 'Username must be alphanumeric').isAlphanumeric()
    ctx.checkBody('username', 'Prohibited username').isBlackListed()
    ctx.checkBody('username', 'Username must start with a letter').startsWithLetter()
    ctx.checkBody('username', 'Username is taken').usernameExists()
    ctx.checkBody('username', 'Username must be lowercase').isLowercase()
}

export function checkEmail(ctx) {
    ctx.checkBody('email', 'Incorrect email').isEmail()
}

export function checkIfEmailIsTaken(ctx) {
    ctx.checkBody('email', 'Email is already taken').emailExists()
}

export function checkRealName(ctx) {
    ctx.checkBody('name', 'Name is not valid').isValidName().isLength({min: 2, max: 50})
}

export function checkCompanyName(ctx) {
    ctx.checkBody('company', 'Company is not valid').optional({ checkFalsy: true }).isValidCompanyName().isLength({min: 2, max: 50})
}

export function checkAccountId(ctx) {
    ctx.checkBody('accountId', 'User does not exist').usernameNotExists()
    ctx.checkBody('accountId', 'User must be 2-15 characters').isLength({min: 2, max: 15})
}
