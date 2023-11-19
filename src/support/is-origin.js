const isOrigin = (value) => {
    if (typeof value !== 'string') {
        return false;
    }
    try {
        const { origin } = new URL(value);
        // Origin: <scheme> "://" <hostname> [ ":" <port> ]
        return value === origin;
    } catch (err) {
        return false;
    }
}

export default isOrigin
