export default (ctx, provider, description) => {
    const result = {
        error: 'access_denied',
        error_description: description,
    };

    return provider.interactionFinished(ctx.req, ctx.res, result, {
        mergeWithLastSubmission: false,
    });
}
