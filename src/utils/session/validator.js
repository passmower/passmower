import usernameBlacklist from "../user/username-blacklist.js";
import Account from "../../models/account.js";
import validatorLib from "validator";
import {getText} from "../get-text.js";
import {USERNAME_RULES} from "../user/username.js";

// Custom validators
const customValidators = {
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
    isValidName: (value) => validatorLib.isAlphanumeric(value, 'en-US', {
        ignore: ' ÜÕÖÄüõöä'
    }),
    isValidCompanyName: (value) => validatorLib.isAlphanumeric(value, 'en-US', {
        ignore: ' ÜÕÖÄüõöä'
    }),
    disableFrontendEdit: () => process.env.DISABLE_FRONTEND_EDIT !== 'true'
}

// Validation chain builder
class ValidationChain {
    constructor(ctx, value, field, errorMessage) {
        this.ctx = ctx
        this.value = value
        this.field = field
        this.errorMessage = errorMessage
        this.skipValidation = false
        this.checks = []
    }

    optional(options = {}) {
        const { checkFalsy = false } = options
        if (this.value === undefined || this.value === null || this.value === '') {
            this.skipValidation = true
        } else if (checkFalsy && !this.value) {
            this.skipValidation = true
        }
        return this
    }

    isLength(options) {
        this.checks.push({
            validator: () => validatorLib.isLength(String(this.value || ''), options),
            message: this.errorMessage
        })
        return this
    }

    isAlphanumeric() {
        this.checks.push({
            validator: () => validatorLib.isAlphanumeric(String(this.value || '')),
            message: this.errorMessage
        })
        return this
    }

    isEmail() {
        this.checks.push({
            validator: () => validatorLib.isEmail(String(this.value || '')),
            message: this.errorMessage
        })
        return this
    }

    isLowercase() {
        this.checks.push({
            validator: () => validatorLib.isLowercase(String(this.value || '')),
            message: this.errorMessage
        })
        return this
    }

    // Generic custom check (used to share rules with utils/user/username.js)
    custom(fn) {
        this.checks.push({
            validator: () => fn(this.value),
            message: this.errorMessage
        })
        return this
    }

    // Custom validators
    startsWithLetter() {
        this.checks.push({
            validator: () => customValidators.startsWithLetter(this.value),
            message: this.errorMessage
        })
        return this
    }

    isBlackListed() {
        this.checks.push({
            validator: () => customValidators.isBlackListed(this.value),
            message: this.errorMessage
        })
        return this
    }

    usernameExists() {
        this.checks.push({
            validator: () => customValidators.usernameExists(this.value, this.ctx),
            message: this.errorMessage,
            async: true
        })
        return this
    }

    usernameNotExists() {
        this.checks.push({
            validator: () => customValidators.usernameNotExists(this.value, this.ctx),
            message: this.errorMessage,
            async: true
        })
        return this
    }

    emailExists() {
        this.checks.push({
            validator: () => customValidators.emailExists(this.value, this.ctx),
            message: this.errorMessage,
            async: true
        })
        return this
    }

    isValidName() {
        this.checks.push({
            validator: () => customValidators.isValidName(this.value),
            message: this.errorMessage
        })
        return this
    }

    isValidCompanyName() {
        this.checks.push({
            validator: () => customValidators.isValidCompanyName(this.value),
            message: this.errorMessage
        })
        return this
    }

    disableFrontendEdit() {
        this.checks.push({
            validator: () => customValidators.disableFrontendEdit(),
            message: this.errorMessage
        })
        return this
    }

    async validate() {
        if (this.skipValidation) {
            return []
        }

        const errors = []
        for (const check of this.checks) {
            let result
            if (check.async) {
                result = await check.validator()
            } else {
                result = check.validator()
            }
            if (!result) {
                errors.push({
                    param: this.field,
                    msg: check.message,
                    value: this.value
                })
            }
        }
        return errors
    }
}

// Middleware that adds validation methods to ctx
export default function koaValidator() {
    return async (ctx, next) => {
        ctx._validationChains = []

        ctx.checkBody = (field, errorMessage) => {
            const value = ctx.request.body?.[field]
            const chain = new ValidationChain(ctx, value, field, errorMessage)
            ctx._validationChains.push(chain)
            return chain
        }

        ctx.check = (field, errorMessage) => {
            // For general checks that don't depend on a specific field
            const chain = new ValidationChain(ctx, null, field, errorMessage)
            ctx._validationChains.push(chain)
            return chain
        }

        ctx.validationErrors = async () => {
            const allErrors = []
            for (const chain of ctx._validationChains) {
                const errors = await chain.validate()
                allErrors.push(...errors)
            }
            // Clear chains after validation
            ctx._validationChains = []
            return allErrors.length > 0 ? allErrors : false
        }

        await next()
    }
}

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
    // Format/blacklist rules are shared with the `upstream` enrollment path.
    for (const rule of USERNAME_RULES) {
        ctx.checkBody('username', rule.message).custom(rule.test)
    }
    ctx.checkBody('username', 'Username is taken').usernameExists()
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

export function checkDisableFrontendEdit(ctx) {
    ctx.check('', getText('disable_frontend_edit')).disableFrontendEdit()
}
