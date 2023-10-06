function corsHeadersMiddleware (_req, res, next) {
	// CORS headers
	// for more details: http://www.html5rocks.com/en/tutorials/cors/
	res.set({
		'Access-Control-Allow-Origin':'*',
		'Access-Control-Allow-Method': 'GET',
		'Access-Control-Allow-Headers': 'X-Requested-With, ETag',
		'Access-Control-Expose-Headers':'ETag',
		'Server': 'Bertha'
	});

	next();
}

module.exports = corsHeadersMiddleware;
