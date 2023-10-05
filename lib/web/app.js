const express = require('express');
const compression = require('compression');
const favicon = require('serve-favicon');
const path = require('path');
const serveStatic = require('serve-static');
const errorhandler = require('errorhandler');
const http = require('http');
const _ = require('lodash');
const plugins = require('../plugins');
const queueing = require('../queue');
const view = require('./view.js');
const purge = require('./purge.js');
const { rateLimit, defaultRateLimitOptions } = require('./rate-limit.js')
const requestId = require('./request-id.js');
const cors = require('./cors.js');

var defaultOptions = {
	port: process.env.PORT || 3000,
	trustProxy: true,
	mode: process.env.NODE_ENV || 'production',
};

exports.create = function create( options, callback ) {

	options = _.extend( {}, defaultOptions, options );
	callback = callback || function(){};

	var app = express();

	if ( options.trustProxy ) {
		app.enable('trust proxy');
	}

	app.disable('x-powered-by');

	if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
		console.log( 'Configuring for Development mode' );
		app.use(errorhandler());

		const morgan = require('morgan')
		app.use(morgan('dev'));
	}

	app.use(requestId);

	app.use(compression());

	app.use(knownParams)

	if (process.env.NODE_ENV !== 'production') {
		app.use(serveStatic(path.join(__dirname,'/public')));
	}

	app.use(cors);

	app.set('port', options.port);
	app.set('queueRegistry', queueRegistry);

	app.get('/', rateLimit({
		...defaultRateLimitOptions,
		ruleName: 'root',
		windowMs: 1000 * 60 * 5,
		max: 100,
		skipSuccessfulRequests: true,
	}), rootHandler)
	
	app.get( '/robots.txt', function (req, res) {
		res.type('text/plain')
		res.send("User-agent: *\nDisallow: /");
	});

	app.get('/trace-headers', traceHeaders)
	app.get('/trace-rate-limit', rateLimit({
		...defaultRateLimitOptions,
		ruleName: 'trace',
		windowMs: 2000,
		max: 1,		
	}), traceRateLimit)

	app.use(favicon(path.join(__dirname, '/public/images/favicon.ico')));

	app.set( 'messageParsingFactory', plugins.getMessageHandler );

	app.param('queue', queue);
	app.param('plugin', plugin);
	app.param('key', keyParam);
	app.param('sheet', sheetParam);

	const viewMiddleware = [
		rateLimit({
			...defaultRateLimitOptions,
			ruleName: 'view',
			skipSuccessfulRequests: true,
			windowMs: 1000 * 60 * 15,
			max: 100,
		}),
		view.respond(),
	];
	app.get('/view/:queue/:plugin/:key', viewMiddleware);
	app.get('/view/:queue/:plugin/:key/:sheet', viewMiddleware);

	const republishRateLimit = rateLimit({
		...defaultRateLimitOptions,
		ruleName: 'republish',
		windowMs: 1000 * 30,
		max: 30,
	})

	const purgeMiddleware = [
		republishRateLimit,
		purge.headers(),
		purge.purge(),
		purge.response()
	];
	app.get('/purge/:queue/:plugin/:key', purgeMiddleware);
	app.get('/purge/:queue/:plugin/:key/:sheet', purgeMiddleware);

	const republishMiddleware = [
		republishRateLimit,
		purge.headers(),
		purge.purge(),
		view.respond(),
	];
	app.get('/republish/:queue/:plugin/:key', republishMiddleware);
	app.get('/republish/:queue/:plugin/:key/:sheet', republishMiddleware);

	app.start = function( cb ) {
		var port = app.get('port');

		http.createServer( app ).listen(port, function(){
			cb.apply( app, arguments );
		});

		return app;
	};

	callback.call( app, options );
	return app;
};


// TODO: do this properly. Implement multichannel queuing;
var availableQueues = {};
var defName = process.env.QUEUE || 'publish';
var defQueue = availableQueues[defName] = new queueing.QueueClient(defName);
defQueue.start();

function queueRegistry (name) {
	return availableQueues[name];
}

function queue (req, res, next) {
	var lookup = res.app.get('queueRegistry'),
		q = lookup(req.params.queue);

	if ( !q ) {
		return notFound(res);
	}

	req.queue = q;
	next();
}

function sheetParam (req, res, next) {
	const sheet = doubleDecodeURIComponent(req.params.sheet);
	if (!sheet || /[?&:`\\(){}\!/]/g.test(sheet) || /[^\x20-\x7E]+/g.test(sheet)) {
		return badRequest(res)
	}
	next()
}

function keyParam (req, res, next) {
	const spreadsheetKey = doubleDecodeURIComponent(req.params.key);
	// We can only exclude bad looking characters
	// because it's not clear what characters
	// Google spreadsheet IDs allow
	if (!spreadsheetKey || /[@\s%?&:`\\(){}\!/]/g.test(spreadsheetKey) || /[^\x20-\x7E]+/g.test(spreadsheetKey)) {
		return badRequest(res)
	}
	const len = spreadsheetKey.length
	if (len < 20 || len > 200) {
		return badRequest(res)
	}
	next()
}

const validPlugins = new Set([
	'dsv',
	'gss',
	'ig',
	'js',
	'profile',
])

const badValues = new RegExp(`(${[
	'cookie',
	'window',
	'__proto__',
	'indexedDB',
	'constructor',
	'fullScreen',
	'location',
	'document',
].join('|')})`, 'g')

function plugin( req, res, next ) {

	var pluginName = req.params.plugin;

	if (doubleDecodeURIComponent(pluginName) !== pluginName) {
		return badRequest(res);
	}

	if (!validPlugins.has(pluginName)) {
		return notFound(res)
	}

	if (pluginName === 'js') {
		const d = doubleDecodeURIComponent(req.query.d)
		if (/[[\]{}`';/*%\!]/g.test(d) || badValues.test(d)) {
			return badRequest(res)
		}
	}
	
	const messageParser = res.app.get('messageParsingFactory')(pluginName);
	const message = messageParser( req );

	req.plugin = {
		name: pluginName,
		message,
	};

	next();
}

function rootHandler (req, res) {
	const query = req.query
	// Using quey params on the root handler is suspicious traffic
	if (Object.keys(query).length) {
		return badRequest(res)
	}
	return notFound(res)
}

function badRequest (res, message) {
	return res.status(400)
	.send(message || 'Bad Request')
	.end();
}

function notFound (res) {
	return res.status(404)
	.send('Not Found')
	.end();
}

const knownQueryParams = new Set([
	'd',
	'd2',
	'q',
	'source',
	'_source',
	'exp',
	'cache',
	'nocache',
])

function knownParams (req, res, next) {
	const queryKeys = Object.keys(req.query || {})
	for (const queryParam of queryKeys) {
		if (!knownQueryParams.has(queryParam)) {
			return badRequest(res, 'Unknown query param')
		}
	}
	next()
}

function traceHeaders (req, res) {
	console.log({
		url: req.originalUrl,
		h: req.headers
	})
	return notFound(res)
}

function traceRateLimit (req, res) {
	if (req.query.d === 'error') {
		return badRequest(res)
	}
	res.send('Not rate limited')
}

// To defend against clever malicious traffic double decoding
// parameter values
function doubleDecodeURIComponent (value) {
	return decodeURIComponent(decodeURIComponent(value || ''))
}
