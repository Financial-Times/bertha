const expressRateLimit = require('express-rate-limit')

const validModes = new Set(['silent', 'report', 'error'])

const mode = (
    process.env.RATE_LIMIT && validModes.has(process.env.RATE_LIMIT)
    ? process.env.RATE_LIMIT
    : undefined
)

// rateLimit middleware is a noop unless process.env.RATE_LIMIT
// has a valid value
const rateLimit = mode ? expressRateLimit : noopMiddleware

console.log(`Rate limiting is ${
    mode ? `enabled in ${mode} mode` : 'disabled'
}`)

const defaultRateLimitOptions = {
	message: 'Rate limited',
	draft_polli_ratelimit_headers: true,
	mode,
	ruleName: 'default',
	keyGenerator,
	handler,
}

function handler (req, res, next, options) {
    logRequest(req, options)

    if (options.mode === 'error') {
        res.status(options.statusCode).send(options.message).end();
    } else {
        next();
    }
}

function getIpAddress(req) {
    return req.get('fastly-client-ip') || req.ip
} 

function keyGenerator (req) {
    return getIpAddress(req)
}

function noopMiddleware () {
    return (_req, _res, next) => {
        next()
    }
}

function logRequest (req, options) {
    if (!options.mode || options.mode === 'silent') {
        return
    }

    const data = {
        event: 'RATE_LIMIT',
        mode: options.mode,
        ip: getIpAddress(req),
        ips: req.ips,
        path: req.path,
        rule: options.ruleName,
        request_id: req.requestId,
        ja3_fingerprint: req.get('ja3-fingerprint'),
        user_agent: req.get('user-agent'),
        sec_fetch_site: req.get('Sec-Fetch-Site'),
    }

    console.log(
        Object.entries(data)
            .map(([k, v]) => `${k}="${printValue(v)}"`)
            .join(' ')
    )
}

function printValue (value) {
    if (Array.isArray(value)) {
        return value.map(printValue).join(', ')
    }
    if (typeof value !== 'string') {
        return ''
    }
    // escape values
    return value.replace(/"/gm, '\"')
}

module.exports = {
    rateLimit,
    defaultRateLimitOptions,
}
