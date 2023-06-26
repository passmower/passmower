import {parseRequestMetadata} from "./parse-request-headers.js";

export const auditLog = (ctx, extras, message) => {
  const headers = parseRequestMetadata(ctx.headers, undefined, undefined)
  globalThis.logger.info({
      request: headers,
      session: ctx?.currentSession,
      adminSession: ctx?.adminSession,
      ...extras
  }, message)
}
