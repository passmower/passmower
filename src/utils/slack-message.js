// Slack messages Passmower composes as Block Kit rather than a wall of text
// (#17). Block Kit is what gives a DM a real call-to-action button instead of a
// raw URL the client may line-wrap, truncate in a preview, or turn into an
// unhelpful unfurl.
//
// The buttons here are **link buttons** — they carry a `url` and no
// `action_id`, so clicking one opens the browser and Slack never calls back.
// That is deliberate: a button Slack has to POST about would require a public
// interactivity request URL and signing-secret verification, i.e. an inbound
// webhook surface on the IdP. A link button gets the UX with no new surface.
//
// Every message keeps a plain `text` alongside its blocks: Slack uses it for
// the notification, the sidebar preview, and clients that cannot render blocks.

// Slack mrkdwn reserves these three characters, and unescaped they silently
// mangle the message (`<` starts a link span). Display names and client ids
// come from CRDs, so they are not ours to trust.
export const escapeMrkdwn = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

const section = (text) => ({type: 'section', text: {type: 'mrkdwn', text}})

// Slack rejects a button whose text exceeds 75 characters, and a URL over 3000.
const MAX_BUTTON_TEXT = 75

const linkButton = (label, url) => ({
    type: 'actions',
    elements: [{
        type: 'button',
        text: {type: 'plain_text', text: label.slice(0, MAX_BUTTON_TEXT), emoji: true},
        url,
        style: 'primary',
    }],
})

const context = (lines) => ({
    type: 'context',
    elements: lines.filter(Boolean).map(text => ({type: 'mrkdwn', text})),
})

// The magic-link DM: what is being signed in to, a Sign in button, and the
// request's provenance so an unexpected message is recognisable as such.
// `text` is the same body the email carries, so the Slack notification preview
// still says what happened and the link survives a blocks-less client.
export const loginLinkMessage = ({url, instance, email, client, browser, ip, text}) => {
    const target = client ? `*${escapeMrkdwn(client)}*` : `*${escapeMrkdwn(instance)}*`
    return {
        text,
        blocks: [
            section(`Sign in to ${target} as ${escapeMrkdwn(email)}`),
            linkButton('Sign in', url),
            context([
                browser ? `Requested from ${escapeMrkdwn(browser)}` : null,
                ip ? `IP ${escapeMrkdwn(ip)}` : null,
                'If this wasn\'t you, ignore this message.',
            ]),
        ],
    }
}
