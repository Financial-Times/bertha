var events    = require('events'),
  util    = require('util'),
  url     = require('url'),
  _     = require('lodash'),
  redisLib  = require("redis");

var connectionTimeMax = 1000 * 100;

function isCached( opts ) {

  opts.callCount = (opts.callCount || 0) + 1;

  if ( opts.callCount >= 5 ) {
    console.error('Reached call count');
    var callcountErr = new Error('Too many tries');
    callcountErr.statusCode = 408;
    opts.error( callcountErr, opts.key );
    return;
  }

  var redis = pool.getRedisConnection();

  if ( !redis ) {
    console.error('No connection to Redis - when try to view');
    var re = new Error( 'No connection to Redis.' );
    re.statusCode = 503;
    opts.error(re);
    return re;
  }

  redis.hgetall(opts.key, function( redisErr, obj ) {

    if ( redisErr ) {
      console.error('Redis Error: failed to perform HGETALL');
      opts.always( opts.key );
      opts.error( redisErr, opts.key );
      return;
    }

    if ( !obj ) {
      opts.always( opts.key );
      opts.no( wrapIsCached(opts), opts );
      return;
    }

    var hasMatchingEtag = function() {
  		return !!opts.etag && opts.etag === obj.etag;
  	};

  	var isInDate = function() {
  		return !!opts.lastModified && new Date(opts.lastModified) >= new Date(obj.lastModified);
  	};

    if ( hasMatchingEtag() || (!opts.etag && isInDate()) ) {
      opts.always( opts.key );
      opts.notModified( obj, opts.key );
      return;
    }

    opts.always( opts.key );
    opts.yes( obj, opts.key );

  });

  return this;
}

function wrapIsCached( opts ) {
  return function() {
    isCached( opts );
  };
}

var currentlyDeleting = {};

function purgeDone(msg, err) {
  var callbacks = currentlyDeleting[msg];
  delete currentlyDeleting[msg];
  for (var i = 0, x = callbacks.length; i < x; i++) {
    try{
      callbacks[i](err);
    } catch (e) {
      console.error('Error: Could not invoke callback on purge', msg, e.message);
    }
  }
};

function purgeCache( msg, queue, callback ) {

  var redis = pool.getRedisConnection();

  if ( !redis ) {
    console.error('No connection to Redis - when trying purge');
    var re = new Error( 'No connection to Redis.' );
    re.statusCode = 503;
    callback(re);
    return;
  }

  msg = msg.split(':').slice(0, 3).join(':') + ':*';

  if (currentlyDeleting[msg]) {
    currentlyDeleting[msg].push(callback);
    return;
  } else {
    currentlyDeleting[msg] = [callback];
  }

  redis.keys(msg, function(err, keys) {

    if ( err ) {
      console.error('Redis Error: failed to perform KEYS before purging', 'key=' + msg);
      purgeDone( msg, err );
      return;
    }

    if (!keys || !keys.length) {
      purgeDone(msg);
      return;
    }

    var length = keys.length,
        counter = length * 2;

    function countdown() {
      if (--counter) return;
      console.log('keys purged ', keys);
      purgeDone(msg);
    }

    var k;

    for (var i = 0, x = length; i < x; i++) {
      k = keys[i];
      queue.remove(k, countdown);
      redis.del(k, countdown);
      console.log('Remove key ', k);
    }

  });

}


/**
* Redis connection convenience function
*
*/
function connectToRedis( timeout, name ) {

  name = name || 'Unnamed';
  var to;
  var redisStr = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  console.log('Connecting to', redisStr);

  var redisURL = url.parse(redisStr);

  var connection = redisLib.createClient( redisURL.port, redisURL.hostname, {no_ready_check: true} );

  if ( redisURL.auth ) {
    connection.auth(redisURL.auth.split(":")[1]);
  }

  connection.on('error', function( err ) {
    console.error( "Redis Error: " + name + '\n', err );
    process.exit( 1 );
  });

  var hasStartedOk = false;

  connection.on('connect', function() {
    console.log( 'Redis connection begun: ' + name );
    hasStartedOk = true;
    clearTimeout( to );
  });

  connection.on('end', function() {
    console.log( 'Redis connection ended: ' + name );
  });

  to = setTimeout(function() {

    if ( hasStartedOk ) {
      return;
    }

    console.error( 'Startup timed out on Redis connection : ' + name );
    process.exit( 1 );

  }, timeout || 10000);

  return connection;
}

var connections = {
  publish:null,
  subscribe:null,
  normalRedis:null
};

var pool = {

  getPubishConnection: function( timeout ) {
    if ( !connections.publish ) {
      connections.publish = connectToRedis( timeout || connectionTimeMax, 'Redis Publish Client' );
    }

    return connections.publish;
  },

  getSubscribeConnection: function( timeout ) {
    if ( !connections.subscribe ) {
      connections.subscribe = connectToRedis( timeout || connectionTimeMax, 'Redis Subscribe Client' );
    }

    return connections.subscribe;
  },

  getRedisConnection: function( timeout ) {
    if ( !connections.normalRedis ) {
      connections.normalRedis = connectToRedis( timeout || connectionTimeMax, 'Default Redis Client' );
    }

    return connections.normalRedis;
  },

  disconnectAll: function( callback ) {

    var conns = [];

    if ( connections.publish ) {
      conns.push( connections.publish );
    }

    if ( connections.subscribe ) {
      conns.push( connections.subscribe );
    }

    if ( connections.normalRedis ) {
      conns.push( connections.normalRedis );
    }

    callback = _.after( conns.length, callback || function(){} );

    conns.forEach(function( c, i ){
      c.on( 'end', callback).quit();
    });

  },

  killAll: function() {
    try {
      if ( connections.publish ) {
        connections.publish.end();
      }

      if ( connections.subscribe ) {
        connections.subscribe.end();
      }

      if ( connections.normalRedis ) {
        connections.normalRedis.end();
      }
    } catch (e) {
      console.log('Error killing Redis connections');
    }
  }
};

exports.pool = pool;
exports.isCached = isCached;
exports.purgeCache = purgeCache;
