var cache = require('../cache');


var responseTypes = {
	'text': 'text/plain',
	'html': 'text/html',
	'csv': 'text/csv',
	'tsv': 'text/tsv',
	'js': 'text/javascript'
};

exports.respond = function respond() {

	return function ( req, res ) {

		var onError = sendError.bind( res ),
		onSuccess = sendJSON.bind( res ),
		onNotModified = notModified.bind( res ),
		msg = req.plugin.message,
		timedout = false;

		var to = setTimeout(function(){
			timedout = true;
			logError({
				event: 'TIMEOUT',
				key: msg,
				requestId: req.requestId,
			})
			var nf = new Error('Timed out');
			nf.statusCode = 408;
			onError( nf );
		}, 15000);

		var opts = {
			key: msg,
			requestId: req.requestId,
			etag: req.get('If-None-Match'),
			lastModified: req.get('If-Modified-Since'),
			notModified: function (doc, key) {
				if (!timedout) {
					onNotModified(doc, key);
				}
			},
			no: enqueue( req.queue ),
			yes: function(doc, key) {
				if (!timedout) {
					onSuccess(doc, key);
				}
			},
			error: function(err, key) {
				clearTimeout(to);
				onError(err, key);
			},
			always: function( key ) {
				clearTimeout( to );
			}
		};

		try {
			cache.isCached( opts );
		} catch (err) {
			clearTimeout( to );
			onError( err );
		}
	}

};

function setCachingHeaders(req, resp, doc) {

	var undefinedCacheLength = !doc.cache && doc.cache !== 0;
	var cache = doc.cache;
	var year = 31536000;
	var sMaxAgeDefault = 60;
	var cacheLength = parseCacheRule( cache ) || 0;
	var sMaxAge;

	if (undefinedCacheLength) {
		sMaxAge = sMaxAgeDefault;
	} else {
		sMaxAge = Math.max(sMaxAgeDefault, cacheLength);
	}

	if ( !resp.get('Cache-Control') ) {
		if (req.query && req.query.nocache) {
			resp.set('Cache-Control', 'public, s-maxage=0, max-age=0, stale-while-revalidate=86400, stale-if-error=259200');
			resp.set('Surrogate-Control', 'max-age=0');
		} else {
			resp.set('Cache-Control', 'public, s-maxage=' + sMaxAge + ', max-age=' + Math.min(cacheLength, year) + ', stale-while-revalidate=86400, stale-if-error=259200');
			resp.set('Surrogate-Control', 'max-age=' + sMaxAge);
		}
	}

	if ( !resp.get('ETag') && doc.etag ) {
		resp.set( 'ETag', doc.etag );
	}

	if (!resp.get('Last-Modified') && doc.lastModified) {
		resp.set( 'Last-Modified', doc.lastModified );
	}
}

function notModified( doc, key ) {
	if (this.headersSent) return;
	setCachingHeaders(this.req, this, doc);
	this.status(304).send('').end();
}

function enqueue( queueClient ) {
	return function( tryAgain, opts ) {

		function evtHandler( evt, result, data ) {
			if ( evt === 'succeed' ) {
				tryAgain();
				return;
			}

			opts.error( result );
		}

		function pushCallback( redisErr ) {
			if ( redisErr ) {
				queueClient.removeListener( opts.key, evtHandler );
				opts.error( redisErr );
				return;
			}
		}
		queueClient.once(opts.key, evtHandler).push(opts.key, pushCallback);
	};
}

function sendError( err, a, b ) {
	if (this.headersSent) return;
	var key = this.req.plugin ? this.req.plugin.message : '';
	logError({
		event: 'WORKER_ERROR_MSG',
		requestId: this.req.requestId,
		status: err.statusCode,
		message: err.message,
		code: err.code,
		duration: err.duration,
		key,
	})
	let message = err.message
	let statusCode = err.statusCode || 500
	// We don't want potentially sensitive info about the nature of the error
	// to be exposed in production
	if (process.env.NODE_ENV === 'production') {
		if (statusCode === 429) {
			// We don't want the client to know we've been rate limited by the Google API
			// And we also don't want a Google Rate Limit error to look like a Bertha rate
			// limit in the Heroku router logs. So we change the code and message to be one
			// about rate limiting
			statusCode = 504
			message = 'Upstream error'
		} else if (statusCode >= 500) {
			message = 'Internal server error'
		}
	}
	this.status(statusCode).json({ message });
}

function logError (data) {
	console.error(
		Object.entries(data)
			.map(([k,v]) => `${k}="${v}"`)
			.join(' ')
	)
}

function sendJSON( doc ) {
	var resp = this;
	var req = resp.req;

	if (resp.headersSent) return;

	setCachingHeaders(req, resp, doc);

	resp.charset = doc.charset || resp.charset || 'utf-8';

	var type = doc.type;

	if (type === 'json') {
		resp.set('Content-Type', 'application/json');
	} else if (type in responseTypes) {
		resp.set('Content-Type', responseTypes[type]);
	} else {
		resp.set('Content-Type', responseTypes.text);
	}

	resp.status(200).send(doc.body);
}

var durations = {
	'none': 0,
	'minute': 60,
	'hour': 60*60,
	'day': 60*60*24,
	'week': 60*60*24*7,
	'month':60*60*24*31,
	'year':60*60*24*365
};

var shortHands = {
	'none':0,
	'tiny':10,
	'short':durations.minute * 10, // 10mins
	'medium': durations.week*1.5, // 10.5 days
	'long':durations.day*90, // 90 days
	'forever':durations.year // never cache more than a year
};

function parseCacheRule( str ) {
	if (str === null || str === undefined) {
		return shortHands.none;
	}

	if ( !isNaN(Number(str)) ) {
		return parseInt( str, 10 );
	}

	str = str.trim().replace(/\,/gi, '').replace(/s$/i,'').toLowerCase();

	var split = str.split(/\s/g);

	try{
		if ( shortHands.hasOwnProperty(split[0]) ) {
			return shortHands[str];
		} else if ( /^\d+(\s?)+[a-z]+$/.test(str) && split[1] && durations.hasOwnProperty(split[1]) ) {
			var num = Number( split[0] );
			if ( isNaN(num) ) {
				return shortHands.none;
			}
			return num * durations[split[1]];
		} else {
			return shortHands.none;
		}
	} catch(err) {
		return 0;
	}
}
