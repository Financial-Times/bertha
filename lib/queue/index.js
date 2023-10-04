// queue.js

var events	= require('events'),
	util	= require('util'),
	_		= require('lodash'),
	cache	= require('../cache'),
	Job		= require('./job');


var connections = {
		publishRedisClient: cache.pool.getPubishConnection(process.env.REDIS_TIMEOUT),
		subscribeRedisClient: cache.pool.getSubscribeConnection(process.env.REDIS_TIMEOUT),
		redisClient: cache.pool.getRedisConnection(process.env.REDIS_TIMEOUT)
	};

/**
*	QueueClass
*
*/
var Queue = exports.Queue = function Queue( name, options ) {
	commonInit.call( this, name, options );
	this.instance = ++instance;
};

util.inherits( Queue, events.EventEmitter );

Queue.prototype.stop = function stop() {

	if ( this.interval ) {
		this.interval = clearInterval( this.interval );
	}

	if ( this.job ) {
		this.job.stop();
		this.unshift( this.message );
		this.job = null;
		this.message = null;
	}


	this.emit( 'running', false );
};

var instance = 0;

Queue.prototype.start = function start() {

	clear.call( this );
	this.interval = setInterval( this.shift.bind(this), 333, onMessage.bind(this) );
	this.emit( 'running', true );
};


Queue.prototype.shift = function shift( callback ) {

	if ( this.callback ) {
		return;
	}

	this.callback = callback;

	_.defer( doShift.bind( this, callback ) );
};

Queue.prototype.unshift = function unshift( message ) {
	this.emit( 'unshift', message );
};

/**
* private functions
*/

function onMessage( message ) {
	var succeed, fail, job;

	try{
		succeed = onSucceededJob.bind( this ),
		fail = onFailedJob.bind( this );
	} catch ( e ) {
		this.emit( 'error', e );
	}

	try{
		this.message = message;
		job = this.job = Job.create( this.message )
								.once( 'succeed', succeed )
								.once( 'fail', fail )
								.start();

	} catch ( e ) {
		fail( e, job );
	}
}

function clear() {

	var isNotIdle = !!this.callback;

	this.callback = null;
	this.job = null;
	this.message = null;

	if ( !isNotIdle ) {
		this.emit('idle');
	}
}

function onSucceededJob( job ) {
	try{
		this.publishRedisClient.publish( this.events.succeed, this.message );
		this.emit( 'succeed', this.message );
		_.defer( clear.bind( this ) );
	} catch ( e ) {
		this.emit('error', e);
	}
}

function onFailedJob( error, job ) {
	try{
		// TODO: proper format for error messages & codes
		// or get the job put the error details in another key in redis & just pass the message
		var p = {
			error: error.message || 'Unknown Error',
			statusCode: error.statusCode || 404,
			code: error.code,
			message: this.message,
			data: '',
			duration: error.duration,
		};
		var ps = JSON.stringify(p, null, 0);
		this.publishRedisClient.publish( this.events.fail, ps );
		this.emit( 'fail', error, this.message, job && job.get('plugin') );
		_.defer( clear.bind( this ) );
	} catch ( e ) {
		this.emit('error', e);
	}
}

function doShift( callback ) {

	callback = callback || function(){};
	var self = this;

	try {
		var multi = this.redisClient.multi(),
			commands = multi.zrange(this.name, 0, 0).zremrangebyrank(this.name, 0, 0);

		commands.exec(function(error, replies) {
			if ( error ) {
				console.log('Redis Error - failed to Shift the queue');
				self.emit( 'error', error );
			}

			var message,
				hasMessage = replies && replies[0] && replies[0].length;

			if ( hasMessage ) {
				message = replies[0][0];
				self.emit( 'shift', message );
				callback( message );
			} else {
				clear.call( self );
			}
		});
	} catch ( e ) {
		console.error('Error doing queue shift');
		this.emit( 'error', e );
	}
}

function eventName( event, message ) {
	return this.events[event] + '.' + message;
}


/* Helper functions */

var baseEvents = {
	'running': 'name.running',
	'idle': 'name.idle',
	'succeed': 'name.succeed',
	'push': 'name.push',
	'shift': 'name.shift',
	'unshift': 'name.unshift',
	'fail': 'name.fail',
	'rescheduled': 'name.rescheduled',
	'error': 'name.error'
};

function createEvents ( name ) {

	var evts = _.extend( {}, baseEvents );

	_.each(evts, function( value, key ) {
		evts[key] = value.replace( 'name', name );
	});

	return evts;
}

function commonInit( name, options ) {
	options = _.extend( {}, connections, options || {} );
	this.name = name || 'queue';
	this.events = createEvents( this.name );
	this.publishRedisClient = options.publishRedisClient;
	this.subscribeRedisClient = options.subscribeRedisClient;
	this.redisClient = options.redisClient;

}


/**
*	QueueClient Class
*
*/
var QueueClient = exports.QueueClient = function QueueClient ( name, options ) {
	commonInit.call( this, name, options );
	this.setMaxListeners(0);
};

util.inherits( QueueClient, events.EventEmitter );

QueueClient.prototype.stop = function stop() {
	try {
		this.subscribeRedisClient.pusubscribe( this.name + '.*' );
		if ( this.callback ) {
			this.subscribeRedisClient.removeListener( 'pmessage', this.callback );
		}
		this.emit( 'running', false );
	} catch ( e ) {
		console.error('Error doing queue stop');
		this.emit( 'error', e );
		throw e;
	}
};

QueueClient.prototype.start = function start() {
	try {
		this.subscribeRedisClient.psubscribe( this.name + '.*' );

		var self = this;

		this.callback = onSubscriptionMessage.bind( this );
		this.subscribeRedisClient.on( 'pmessage', this.callback );

		this.emit( 'running', true );
	} catch ( e ) {
		console.error('Error doing queue start');
		this.emit( 'error', e );
		throw e;
	}
};

QueueClient.prototype.push = Queue.prototype.push = function push( message, callback, unshift ) {

	callback = callback || function(){};

	try {

		var self = this,
			ts = unshift ? 1 : Date.now(),
			evt = unshift ? 'unshift' : 'push';

		this.redisClient.zscore(this.name, message, function( err, score ) {
			if ( err ) {
				console.error('Redis Error - failed to perform ZSCORE on queue client push')
				callback( err, false );
				self.emit( 'error', err )
				return;
			}

			if ( score != null ) {
				callback( null, false );
				return;
			}

			self.redisClient.zadd([self.name, ts, message], function( err, reply ) {
				if (err) {
					console.error('Redis Error - failed to perform ZADD on queue client push');
				}
				callback( err, !err );
				self.emit( evt, message, !err );
			});

		});
	} catch ( e ) {
		console.error('Error doing queue push');
		this.emit( 'error', e );
	}
};

QueueClient.prototype.unshift = Queue.prototype.unshift = function unshift( message, callback, push ) {
	this.push( message, callback, !push);
};

function onSubscriptionMessage( pattern, evt, message ) {
	try{
		var localEvt = evt.substr( evt.indexOf('.') + 1 ),
			args = [localEvt],
			parsedMessage, newError;
		if ( evt === this.events.fail || evt === this.events.fail ) {
			parsedMessage = JSON.parse( message, null, 0 );
			newError = new Error( parsedMessage.error );
			newError.statusCode = parsedMessage.statusCode;
			newError.code = parsedMessage.code;
			newError.duration = parsedMessage.duration
			args.push( newError );
			args.push( parsedMessage.data );
			this.emit.apply( this, args );
			this.emit(parsedMessage.message, localEvt, newError);
		} else {
			args.push(message);
			this.emit.apply( this, args );
			this.emit(message, localEvt);
		}

	} catch	( e ) {
		this.emit( 'error', e );
	}
}

QueueClient.prototype.remove = Queue.prototype.remove = function remove( message, callback ) {
	this.redisClient.zrem( this.name, message, function (err, value) {
		if (err) {
			console.error('Redis Error - failed to perform ZREM on queue client remove', msg);
		}
		callback(err, value);
	});
};


var QueueErrorHandler = function QueueErrorHandler( queue ) {
	//shut if down if it errors
};
