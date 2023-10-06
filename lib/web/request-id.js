function requestIdMiddleware (req, res, next) {
	req.requestId = req.get('X-Request-ID') || (Date.now() + Math.random() * 1e5).toString(32);
	res.set('X-Request-ID', req.requestId);

	next();
}

module.exports = requestIdMiddleware;
