/*

User's list of spreadsheets: https://spreadsheets.google.com/feeds/spreadsheets/private/full
List all the sheets in a spreadsheet: https://spreadsheets.google.com/feeds/worksheets/key/private/full
A Sheet's Data in "list" form: https://spreadsheets.google.com/feeds/list/key/worksheetId/private/full

*/

var _ = require('lodash');
var request = require('google-oauth-jwt').requestWithJWT(require('request'));
var moment = require('moment');
var yaml = require('js-yaml');
var md = require('markdown-it')({
            linkify: true,
            typographer: true,
            breaks: true
          })
          .use(require('markdown-it-anchor'));


var Api = function Api() {};

var baseURL      = 'https://spreadsheets.google.com/feeds',

    visibilities = Api.visibilities = {
      'private' : 'private',
      'public'  : 'public'
    },

    projections  = Api.projections ={
      'full'  : 'full',
      'basic' : 'basic'
    },

    feeds        = Api.feeds = {
      'spreadsheets': 'spreadsheets',
      'spreadsheet' : 'spreadsheet',
      'worksheets'  : 'worksheets',
      'list'        : 'list',
      'cells'       : 'cells'
    };

module.exports = function () {
  return new Api();
};

var defaultOpts = {
  feed: feeds.worksheets,
  visibility: visibilities['private'],
  projection: projections['full']
};

Api.prototype.request = function(opts, callback) {

  opts = _.extend({}, defaultOpts, opts);

  var url = baseURL + '/' + opts.feed;
  var q = '?alt=json';

  if (opts.spreadsheetKey && opts.spreadsheetKey.indexOf('public-') === 0) {
    opts.spreadsheetKey = opts.spreadsheetKey.replace(/^public\-/, '');
    opts.visibility = visibilities.public;
  }

  if (opts.feed !== feeds.spreadsheets) {
    url += '/' + opts.spreadsheetKey;
  }

  if (opts.feed === feeds.list || opts.feeds === feeds.cells) {
    url += '/' + opts.worksheetId;
  }

  if (opts.feed !== feeds.spreadsheet) {
    url += '/' + opts.visibility + '/' + opts.projection;
  }

  if (opts.sort && opts.sort.field) {
    q += '&reverse=' + opts.sort.direction.toString() + '&orderby=column:' + opts.sort.field;
  }

  url = url + q;

  var reqOpts = {
    url: url,
    json: true,
    // 22 secs
    timeout: 22000,
    headers: {
      'GData-Version': '3.0',
      'Accept': 'application/json',
      'Content-Type': 'application/json'//,
//      'If-Match': '*',
    },
    jwt: {
      // reuse/cache the auth token for just under an hour
      // it expires after about 1 hour (give or take a couple of secs).
      expiration: 59 * 60 * 1000,
      email: process.env.GOOGLE_CLIENT_EMAIL,
      delegationEmail: process.env.GOOGLE_USER,
      key: process.env.GOOGLE_SERVICE_KEY,
      scopes: [
        'https://spreadsheets.google.com/feeds',
        'https://docs.google.com/feeds'
      ]
    }
  };

  var onResponse = function (err, response, body) {

    var appErr = null;

    if (err) {
      if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
        appErr = new Error('Google Spreadsheet API timeout for URL: ' + url);
        appErr.statusCode = 408;
      } else if (Math.round(err.statusCode / 100) === 4) {
        console.error('FATAL: Google Spreadsheet API auth error', 'Status Code: ' + err.statusCode, err.message, 'Spreadsheet key: ' + opts.spreadsheetKey);
        appErr = new Error('Could not authenticate with the Google Spreadsheet API');
        appErr.statusCode = err.statusCode;
      } else {
        console.error('Unknown Google Spreadsheet API error', err.message, 'Code:' + err.code, 'Status code:' +  err.statusCode, 'Url:' + url);
        appErr = new Error('Unknown Google Spreadsheet API error');
        appErr.statusCode = 500;
        appErr = err;
      }
    } else if (response.statusCode === 403) {
      appErr = new Error('Bertha does not have access to spreadsheet ' + opts.spreadsheetKey);
      appErr.statusCode = response.statusCode;
    } else if (response.statusCode < 200 || response.statusCode >= 400) {
      var message = body ? 'Google API error: ' + body : 'Could not get response from Google API for URL: ' + url;
      appErr = new Error(message);
      appErr.statusCode = response.statusCode || 500;
    }
    callback.call(this, appErr, body);
  };

  console.log('Google Spreadsheet API request', url);

  request(reqOpts, onResponse.bind(this));
};

Api.prototype.spreadsheet = function( key ) {
  return new Spreadsheet( key, this );
};

var Spreadsheet = function Spreadsheet( spreadsheetKey, requestFactory ) {
  this.key = spreadsheetKey;
  this.sheetsByID = {};
  this.sheetsByName = {};
  this.requestFactory = requestFactory;
  this.gotMetadata = false;
  this.metadataError = null;
};

Spreadsheet.prototype.fetchWorksheetFeed = function fetchWorksheetFeed( callback ) {

  callback = callback || function () {};

  var self = this;

  if ( !!self.metadataError ) {
    console.log('Previously found error in that spreadsheet');
    callback( this.metadataError, null );
    return;
  }

  var opts = {
    feed: feeds.worksheets,
    projection: projections['full'],
    visibilities: visibilities['private'],
    spreadsheetKey: self.key
  };

  self.requestFactory.request( opts, function ( err, result ) {
    self.gotMetadata = true;

    if ( err ) {
      self.metadataError = err;
      callback( err, result );
      return;
    }

    if (!result || !result.feed || !result.feed.entry) {
      var malformedError = new Error('Google Spreadsheet response malformed');
      self.metadataError = malformedError;
      callback( malformedError, result );
      return;
    }

    result.feed.entry.forEach(function(n,i) {
      n.sheetId = n.id.$t.substr(n.id.$t.lastIndexOf('/') + 1);
      n.sheetName = n.title.$t;
      var sheet = {details: n, data: null};
      self.sheetsByID[n.sheetId] = sheet;
      self.sheetsByName[n.sheetName] = sheet;
    });

    callback(null, result);
  });
};

Spreadsheet.prototype.fetchSheetDataListFeed = function fetchSheetDataListFeed( sheetNames, opts, callback ) {

  if ( typeof opts === 'function' ) {
    callback = opts;
    opts = {};
  }

  var self = this;

  if ( !!self.metadataError ) {
    console.log('Previously found error in that spreadsheet');
    callback( self.metadataError, null );
    return;
  }

  if ( typeof sheetNames === 'string') {
    sheetNames = [sheetNames];
  }

  var defs = {
        feed:           feeds.list,
        projection:     projections['full'],
        visibilities:   visibilities['private'],
        worksheetId:    null,
        spreadsheetKey: self.key
      },
      fail = callback,
      data = {};

  var sort = opts.sort || {},
      query = opts.query || {};

  if ( !self.gotMetadata ) {
    self.fetchWorksheetFeed(function ( err, result ) {
      if ( err ) {
        fail( err );
        return;
      }
      fetchSheets();
    });
  } else {
    fetchSheets();
  }

  function fetchSheets() {

      // make a copy of the original array - just in case
      var originalSheetNames = sheetNames.concat(),
          sheets = [],
          s,
          errSheetNames = [],
          isOptional, hasSheet;

      // Are the sheets specified available?
      while ( s = originalSheetNames.pop() ) {
        isOptional = s.charAt(0) === '+';
        s = isOptional ? s.substr(1) : s;
        hasSheet = self.sheetsByName.hasOwnProperty(s);

        if ( !hasSheet && !isOptional ) {
          errSheetNames.push(s);
        } else if (hasSheet) {
          // optional sheets that are not
          // available wont get added to sheetNames
          sheets.push(s);
        }
      }

      // fail the job if any mandatory sheets are missing
      if ( errSheetNames.length ) {
        var sheetsNotFoundError = new Error( 'Worksheets not found: ' +  errSheetNames.join(', ') + '.' );
        sheetsNotFoundError.statusCode = 404;
        fail( sheetsNotFoundError );
        return;
      }

      // if there are no sheets to request from the Google API then
      // we still want the job to succeed in case it only included
      // optional sheets names...
      // therefore we act as if there was just an empty object
      // and dont bother making calls to Google
      if ( !sheets.length ) {
        callback( null, {} );
        return;
      }

      // wrap the callback in a function that only fires
      // once all the requests are done
      var success = _.after( sheets.length, callback );

      // get the data for each sheet
      sheets.forEach(function ( name, i ) {

        // make the request config
        var requestConfig = _.extend( {}, defs),
            sheet = self.sheetsByName[name];

        requestConfig.worksheetId = sheet.details.sheetId;

        if ( !!sort[name] ) {
          requestConfig.sort = sort[name];
        }

        if ( !!query[name] ) {
          requestConfig.query = query[name];
        }

        // make request from the Google API
        self.requestFactory.request( requestConfig, function ( listErr, result ) {

            if ( listErr ) {
              fail( listErr );
              return;
            }

            try {
            data[name] = processSheet( result );
            } catch (e) {
              var processingError = new Error('Error processing sheet ' + name);
              processingError.statusCode = 500;
              fail(processingError);
              return;
            }

            success( null, data );
        });

      });
  }
};

function processSheet( result ) {

    var rows = result.feed.entry;

    if ( !rows || !rows.length ) {
      return [];
    }

    var first = rows[0],
        processor = createRowProcessor( first );

    return processor.processRows( rows );
}

function parseBasicValue( val ) {
  val = val || '';

  val = val.trim();

  var res,
      bool = parseBoolean( val ),
      num = Number(val.replace(/\,/g, ''));

    if ( typeof val === 'string' && (val.length === 0 || val.toLowerCase() === 'null') ) {
      return null;
    }

    if (typeof bool === 'boolean') {
      res = bool;
    } else if ( !isNaN(num) ) {
      res = num;
    } else if (typeof val === 'string') {
      res = val;
    }

    return res;
}

function parseList( val, delimiter ) {
  val = (val || '').trim();
  return !val.length ? [] : val.toString().split(delimiter || ',').map(parseBasicValue);
}

function parseArray( val ) {
  return parseList( val, /[\r\n]+/gm);
}

function parseBoolean( val ) {
  val = (val || '').trim();
  var bool;
  try{
    if ( /^(y|yes|true)$/i.test(val) ) {
      bool = true;
    } else if ( /^(n|no|false)$/i.test(val) ) {
      bool = false;
    }
  } catch(e){}
  return bool;
}

function parseDate( val ) {
  if ( !val ) {
    return null;
  }

  var t = val.toString().replace(/[\/\\]/g, '-');
  var notDayMonthYearFormatted = !/^\d{2}\-\d{2}\-\d{4}/.test(t);

  if (notDayMonthYearFormatted) {
    var parts = t.split(/\-/g);
    var isTwoDigits = /^\d{2}$/;
    var isFourDigits = /^\d{4}$/;
    var startsWithYear = isFourDigits.test(parts[0]);
    var thenHasTwoDigitNumber = isTwoDigits.test(parts[1]);
    var followedByAnotherTwoDigitNumber = isTwoDigits.test(parts[2]);

    if (startsWithYear && thenHasTwoDigitNumber && followedByAnotherTwoDigitNumber) {
      parts = [parts[2], parts[1], parts[0]].concat(parts.slice(3));
    } else if (startsWithYear && thenHasTwoDigitNumber) {
      parts = [parts[1], parts[0]].concat(parts.slice(2));
    } else {
    }

    t = parts.join('-');
    var hyphens = (t.match(/\-/g) || []).length;

    if (hyphens === 0 && isFourDigits.test(parts[0])) {
      t = '01-01-' + t;
    } else if (hyphens === 1 && isTwoDigits.test(parts[0])) {
      t = '01-' + t;
    } else if (hyphens === 0 && /^\d{2}\:\d{2}/.test(parts[0])) {
      t = '01-01-1970 ' + t;
    }
  }

  t += t.search(/\ \d{2}\:\d{2}/) === -1 ? ' 00:00' : '';
  t += t.search(/(\-|\+)[\d\:]{4,5}$/) === -1 ? ' +0000' : '';

  var d = moment(t, 'DD-MM-YYYY HH:mm Z' );

  if ( d.isValid() ) {
    return d.utc().toDate().toISOString();
  }

  return val;
}

function parseDateRange( val ) {
  var arr;

  if (!val || !(arr = val.split(/[,\n\r][\ \n\r]*/g)).length) {
    return [];
  }

  return [parseDate(arr[0]), parseDate(arr[1])];
}

function parseLink( cellContent ) {
  cellContent = cellContent || '';
  var arr = parseArray( cellContent ), links = [];
  arr.forEach(function (n,i) {
    if (!n) {
      return;
    }
    var pair = n.split(/\ +(?:(?=(?:\.{0,2}\/)+[\w\?\#][\w\/]+)|(?=[a-z]+\:\/\/\w+)|(?=(?:\?|\#)[\w\/%\+]+))/),
        obj = {
          text: pair[0],
          href: pair.length > 1 ? pair[1] : ( /^((?:\.{0,2}\/)+[\w\?\#][\w\/]+|[a-z]+\:\/\/\w+|(?:\?|\#)[\w\/%\+]+)/i.test(pair[0]) ? pair[0] : null )
        };

    links.push( obj );
  });
  return links;
}

function parseCurrency( val ) {
  if ( typeof val === 'string' && val.length === 0 ) {
      val = null;
  }

  return {value:val,symbol:val};
}

function parsePixelValue( val ) {
  return (types.str(val) || 0) + 'px';
}

function createRowProcessor( row ) {

  if ( !row ) {
    throw new Error( 'Could not create a Row Processor without any data as a basis.' );
  }

  // we done want to effect the actual row data so take a clone
  row = _.clone(row);

  var cols = {},
      c,
      src = [],
      fnNamePattern = /\.{2}(?=\w+$)/i,
      namespacePattern = /\w+\.\w+/g,
      isSpecial = /^special\./i,
      columnFnName,
      now ;

  if ( row['gsx$special.restrict'] ) {
    src.push("if ( /^(y|yes|true|ok|on)$/i.test(e['gsx$special.restrict'].$t) ) {return null;}");
    delete row['gsx$special.restrict'];
  }

  if ( row['gsx$special.embargo'] ) {

    now = moment().utc().toDate().getTime() + 1000; // add 1000 milliseconds just to be safe in case of time rounding (leap seconds).

    // TODO: embargo dates should setup a future purge of this document from the cache
    src.push("var embargoDate = this.moment(e['gsx$special.embargo'].$t)");
    src.push("if ( embargoDate && embargoDate.isValid() && embargoDate.utc().toDate().getTime() > "+ now +" ) {return null;}");
    delete row['gsx$special.embargo'];
  }

  var namespace, lastName;

  function iterateNamespace( nm, ind ) {
    if (!nm || nm === '.') return;
    var p = this.slice(0, ind + 1).join('"]["');
    src.push('o["' + p + '"] = o["' + p + '"] || {}');
  }

  for (var name in row) {
    c = name.split('$');

    if ( c[0] == 'gsx' && c[1] && !isSpecial.test(c[1]) && c[1].toString()[0] !== '_' ) {

        namespace = (c[1].split(/(?=\.{2}\w+$)/i)[0]||'').split('.');
        lastName = null;

        while ( !lastName && namespace.length ) {
          lastName = namespace.pop();
          lastName = lastName === '.' ? null : lastName;
        }

        if (namespace.length > 0) {
          namespace.forEach(iterateNamespace, namespace);
          namespace =  'o["' + namespace.join('"]["') + '"]';
          namespace = namespace.replace(/\[\"\"\]/g,'');
        } else {
          namespace = 'o';
        }


        src.push("e['" + name + "'].$t = (e['" + name + "'].$t || '').trim()");

        columnFnName = c[1].split( fnNamePattern );

        if ( columnFnName.length == 2 && types.hasOwnProperty(columnFnName[1])  ) {
          src.push(namespace + "['" + lastName + "'] = this.parse." + columnFnName[1] + "(e['" + name + "'].$t)");
        } else {
          src.push(namespace + "['" + lastName + "'] = this.parse.basic(e['" + name + "'].$t)");
        }
    }
  }

  src.push('return o');

  var f = new Function('o', 'e', src.join(';')),
      context = {
          moment:moment,
          parse:types
      };

  return new RowProcessor( context, f );
}

function wrapParse(d) {
  return function (val) {
    return parseList(val, d);
  }
}

function parse2d( val, delimiter1, delimiter2 ) {
  return parseList( val, delimiter1 || /\r?\n/gm).map(wrapParse(delimiter2 || ','));
}

function parseIntCell( val ) {
  var res = parseInt( val, 10 );
  return isNaN(res) ? null : res;
}

function getDecimalParser(dp) {
  dp = dp || 0;
  return function(val) {
    if ( val == null ) {
      return null;
    }

    try {
      var n = Number(val);
      return isNaN(n) ? val : n.toFixed(dp);
    } catch (e) {
      return val;
    }
  }
}

function parseYaml(val) {
  if (!val) return val;

  val = val.trim();

  try {
    return yaml.safeLoad(val, {schema: yaml.JSON_SCHEMA});
  } catch(e) {
    return {value: val, error: {message: 'YAML format error', line: e.line, column: e.column}};
  }
}

var types = {
  basic: parseBasicValue,
  md: function(val) {
    return md.render(val).trim();
  },
  mdi: function(val) {
    return md.renderInline(val).trim();
  },
  yaml: parseYaml,
  yml: parseYaml,
  md2: function( val ) {
    return parse2d( val );
  },
  md2semi: function( val ) {
    return parse2d( val, null, ';' );
  },
  map: function( val ) {

    if (!val || !val.length) {
      return null;
    }

    var obj = {};

    var lines = parseList( val, /\r?\n/gm )
                    .map(function ( v ) {
                      return parseList((v || '').toString().replace(/[\,\ \;]+$/, '').replace(/^[\ \t]+/, ''), ':');
                    })
                    .forEach(function ( arr ) {
                      if (arr && arr.length) {
                        if (arr.length > 1) {
                          obj[arr[0]] = arr[1];
                        } else {
                          obj[arr[0]] = null;
                        }
                      }
                    });

    return obj;
  },
  json: function( val ) {

    if (!val || !val.length) {
      return null;
    }

    var obj = {};

    try{
      var sanitized = (val || '').replace(/[\n\r\t]/g, '').replace(/^\{/, '').replace(/\}$/, '').replace(/\,+$/, '');
      obj = JSON.parse('{' + sanitized + '}');
    } catch (e) {
      obj = parseBasicValue(val);
    }

    return obj;
  },
  str: function( val ) {
    return (val || '').toString();
  },
  'int': parseIntCell,
  dp0: parseIntCell,
  dp1: getDecimalParser(1),
  dp2: getDecimalParser(2),
  dp3: getDecimalParser(3),
  dp3: getDecimalParser(3),
  date: parseDate,
  drange: parseDateRange,
  link: parseLink,
  curr: parseCurrency,
  list: parseList,
  li: parseList,
  arr: parseArray,
  array: parseArray,
  bool: function(val) {
    return parseBoolean(val) || false;
  },
  px: parsePixelValue
};

var RowProcessor = function( context, fn ) {

  function iterator( row, indx ) {
    var processedRow = fn.call( context, {}, row );
    if ( processedRow ) {
        this.push( processedRow );
    }
  }

  this.processRows = function( rows ) {
    var result = [];

    rows.forEach( iterator, result );

    return result;
  };

};
