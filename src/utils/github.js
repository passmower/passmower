export function getGitHubConfig(env = process.env) {
    const host = (env.GITHUB_HOST || 'github.com').toLowerCase()
    if (host.length > 253 || !host.split('.').every(label =>
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
        throw new Error('GITHUB_HOST must be a hostname without a scheme, port or path')
    }
    return {
        host,
        oauthBaseUrl: `https://${host}/`,
        apiBaseUrl: host === 'github.com' ? 'https://api.github.com/'
            : host.endsWith('.ghe.com') ? `https://api.${host}/`
                : `https://${host}/api/v3/`,
    }
}
