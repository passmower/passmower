import * as queryString from "querystring";
import * as http2 from "http2";

// Helper class to override @kubernetes/client-node's deprecated `request` library with node.js native http2 implementation.
// https://github.com/kubernetes-client/javascript/issues/559#issuecomment-778221716

class WatchRequest {
    webRequest(options, callback) {
        const {
            ca, headers, method, qs, uri
        } = options;
        const url = new URL(uri);
        const session = http2.connect(url, { ca });
        let ping = null;
        let error = '';
        session.on('error', err => error += err);
        session.on('close', () => {
            clearInterval(ping);
            if (callback instanceof Function) {
                callback(error);
            }
        });
        const stream = session.request({
            ...headers,
            ':method': method,
            ':path'  : `${url.pathname}?${queryString.stringify(qs)}`,
            'accept' : 'application/json'
        }, { 'endStream': false });
        stream.setEncoding('utf8');
        ping = setInterval(() => {
            session.ping(error => {
                if (error || stream.closed) {
                    clearInterval(ping);
                    if (!session.destroyed) {
                        session.destroy(error || 'stream was closed');
                    } else {
                        console.error('session was already destroyed this is unexpected');
                    }
                }
            });
        }, 2000);
        stream.on('error', () => {/* no opt this will allow session 'error' to be emitted instead of throwing an exception */});
        stream.on('close', () => {
            clearInterval(ping);
            session.close();
        });
        stream.abort = () => {
            clearInterval(ping);
        }
        return stream;
    }
}

export default WatchRequest
