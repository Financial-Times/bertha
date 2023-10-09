var util	= require('util'),
	events	= require('events'),
	crc32	= require('buffer-crc32'),
	_		= require('lodash'),
	Message = require('../message'),
	Plugins	= require('../plugins'),
	cache	= require('../cache');


var Job = function( name ){
	this.name = name;
	this._attributes = {
		etag: '',
		type: '',
		cache: '',
		lastModified: '',
		body: ''
	};
};

util.inherits(Job, events.EventEmitter);

Job.prototype.set = function set( name, value ) {

	if ( typeof name === 'string' && this._attributes[name] == value ) {
		return;
	}

	if ( typeof name === 'function') {
		return;
	}

	if ( _.isObject(name) && !value ) {
		_.extend( this._attributes, name );
		this.emit( 'change', _.keys(name), _.values(value), this );
	} else {
		this._attributes[name] = value;
		this.emit( 'change', name, value, this );
	}

};

Job.prototype.get = function get( name ) {
	if ( !name ) {
		return undefined;
	}

	return this._attributes[name];
};

Job.prototype.etag = function etag( val ) {
	val = val || '';
	var len = Buffer.isBuffer(val) ? body.length : Buffer.byteLength(val),
		result = '';

	if ( len === 0 ) {
		result = 'W/"0-0"';
	} else {
		result = 'W/"' + len.toString(16) + '-' + crc32.unsigned( val ) + '"';
	}

	this._attributes.etag = result;
	return result;
};

Job.prototype.succeed = function succeed() {

	if ( this.stopped ) {
		console.log('Job is already stopped');
		return;
	}

	try {

		var self = this;
		var body = this.get('body') || '',
			type = this.get('type') || 'text',
			isString = Buffer.isBuffer(body) || typeof body === 'string';

		if ( type === 'json' ) {
			try{
				body = JSON.stringify(body,null,0);
			} catch (e) {
				self.fail( e );
				return;
			}
		} else if ( !isString ) {
			self.fail( new Error('Body must be a string') );
			return;
		}

		this.set('lastModified', new Date().toUTCString());
		this.etag( body );

		var headers = {
			type: type,
			cache: this.get('cache') || '',
			lastModified: this.get('lastModified') || '',
			etag: this.get('etag') || ''
		};

		var redis = cache.pool.getRedisConnection();

		headers.body = body;

		redis.hmset(self.name, headers, function( redisErr ){
			if (redisErr) {
				// TODO: reschedule task
				self.fail( redisErr );
				return;
			}

			self.emit( 'succeed', self );
		});

	} catch ( e ) {
		this.fail( e );
	}
	return this;
};

Job.prototype.fail = function fail( error ) {
	this.emit( 'fail', error );
	return this;
};

Job.prototype.stop = function stop( ) {
	this.stopped = true;
	this.emit( 'stop', this );
	return this;
};

Job.prototype.start = function start( ) {
	this.stopped = false;

	var pluginName = this.get('plugin');

	if ( !pluginName ) {
		throw new Error('Undefined Plugin name');
	}

	var plugin = Plugins.getPlugin( pluginName );
	plugin.work( this );
	this.emit( 'start', this );
	return this;
};

Job.create = function create( message, timeout ) {
	var obj = Message.deserialize( message );
	const job = new Job( message );

	job.set( obj );

	setTimeout(job.emit, timeout || 1000 * 60 * 10, 'fail', new Error('General Job Timeout'));

	return job;
};

module.exports = Job;
