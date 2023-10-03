var cache = require('../cache');

exports.purge = function purge() {
  return function doPurge( req, res, next ) {
    cache.purgeCache( req.plugin.message, req.queue, function(err) {
      console.log('Purge done', 'key=' + req.plugin.message, 'requestId=' + req.requestId);
      next(err);
    });
  }
};

exports.headers = function headers() {
  return function setPurgeHeaders ( req, res, next ) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'max-age=0');
    next();
  }
};

exports.response = function response() {
  return function purgeResponse( req, res, next ) {
    res.status(200).send('done').end();
  }
};
