var Message = require('../message.js'),
    express = require('express'),
    http = require('http'),
	_ = require('lodash'),
	plugins = require('../plugins'),
	queueing = require('../queue'),
	view = require('./view.js'),
	purge = require('./purge.js');


var defaultOptions = {
	port: process.env.PORT || 3000,
	trustProxy: true,
	mode: process.env.NODE_ENV || 'production',
	docPath: '/view'
};

exports.create = function create( options, callback ) {

	options = _.extend( {}, defaultOptions, options );
	callback = callback || function(){};

	var app = express();

	if ( options.trustProxy ) {
		app.enable('trust proxy');
	}

	app.disable('x-powered-by');

	app.configure('development', function(){
		console.log( 'Configuring for Development mode' );

		// TODO: JSON error handler
		app.enable( 'verbose errors' );
		app.use( express.errorHandler() );

		// TODO: how to use the logger?
		app.use( express.logger('dev') );
	});

	app.configure('production', function(){

		console.log( 'Configuring for Production mode' );

		app.disable( 'verbose errors' );
		app.use( express.errorHandler() );
	});

	app.use(requestId);

	app.use( express.compress() );

	app.use( express.static(__dirname + '/public') );

	app.use(corsHeaders);

	app.set( 'port', options.port );
	app.set( 'queueRegistry', queueRegistry );
	
	app.get( '/robots.txt', function (req, res) {
		res.type('text/plain')
		res.send("User-agent: *\nDisallow: /");
	});

	app.get( '/short/:queue/:plugin/:key', setExpiry('short') );
	app.get( '/short/:queue/:plugin/:key/:sheet', setExpiry('short') );
	app.get( '/long/:queue/:plugin/:key', setExpiry('forever') );
	app.get( '/long/:queue/:plugin/:key/:sheet', setExpiry('forever') );

	app.set( 'messageParsingFactory', plugins.getMessageHandler );

	app.param('queue', queue);
	app.param('plugin', plugin);
	app.param('key', keyParam);
	app.param('sheet', sheetParam);

	app.use( express.favicon(__dirname + '/public/images/favicon.ico') );

	app.use( app.router );

	app.get( '/short/:queue/:plugin/:key', view.respond() );
	app.get( '/long/:queue/:plugin/:key', view.respond() );
	app.get( '/short/:queue/:plugin/:key/:sheet', view.respond() );
	app.get( '/long/:queue/:plugin/:key/:sheet', view.respond() );

	app.get( options.docPath + '/:queue/:plugin/:key', view.respond() );
	app.get( options.docPath + '/:queue/:plugin/:key/:sheet', view.respond() );

	app.get(/^\/(republish|purge)\/.*/, purge.headers());

	app.get('/purge/:queue/:plugin/:key', purge.purge() );
	app.get('/purge/:queue/:plugin/:key/:sheet', purge.purge() );
	app.get('/purge/:queue/:plugin/:key', purge.response() );
	app.get('/purge/:queue/:plugin/:key/:sheet', purge.response());

	app.get('/republish/:queue/:plugin/:key', purge.purge() );
	app.get('/republish/:queue/:plugin/:key/:sheet', purge.purge() );
	app.get('/republish/:queue/:plugin/:key', view.respond() );
	app.get('/republish/:queue/:plugin/:key/:sheet', view.respond() );


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

function queueRegistry( name ) {
	return availableQueues[name];
}

function queue( req, res, next ) {

	var lookup = res.app.get('queueRegistry'),
		q = lookup( req.param('queue') );

	if ( !q ) {
		res.send(404);
		return;
	}

	req.queue = q;
	next();
}

function sheetParam(req, res, next ) {
	const sheet = req.param('sheet');
	if (/[?&:`\\(){}\!/]/g.test(sheet) || /[^\x20-\x7E]+/g.test(sheet)) {
		res.send(400).end();
		return
	}
	next()
}

function keyParam (req, res, next ) {
	const spreadsheetKey = req.param('key');
	// We can only exclude bad looking characters
	// because it's not clear what characters
	// Google spreadsheet IDs allow
	if (/[@\s%?&:`\\(){}\!/]/g.test(spreadsheetKey) || /[^\x20-\x7E]+/g.test(spreadsheetKey)) {
		res.send(400).end();
		return
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

function plugin( req, res, next ){

	var pluginName = req.param('plugin');
	
	if (!validPlugins.has(pluginName)) {
		res.send(404).end();
		return
	}

	if (pluginName === 'js') {
		const d = req.param('d')
		if (/[{}';/*%\!]/g.test(d) || d.includes('cookie') || d.includes('window')) {
			res.send(400).end();
			return
		}
	}
	
	const messageParser = res.app.get('messageParsingFactory')( pluginName ); 
	const message = messageParser( req )

	req.plugin = {
		name: pluginName,
		message,
	};

	next();
}

function corsHeaders(req, res, next) {
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

function requestId(req, res, next) {

	req.requestId = req.get('X-Request-ID') || (Date.now() + Math.random() * 1e5).toString(32);

	if (requestId) {
		res.set('X-Request-ID', req.requestId);
	}

	next();
}

function setExpiry(duration) {
	return function (req, res, next) {
		req.query.exp = duration;
		next();
	}
}
