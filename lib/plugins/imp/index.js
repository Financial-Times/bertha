var Plugins = require('../plugin.js'),
	googleSpreadsheets = require('../../google/googlespreadsheet.js'),
	_ = require('lodash');


var ImpPlugin = Plugins.sub('ImpPlugin', {

	version: '0.0.1',

	name: __dirname,

	init: function init( options ) {

		this.api = googleSpreadsheets();

	},

	destroy: function destroy() {
	},

	doJob: function doJob( job ) {

		var self = this;

		var id = job.get('spreadsheet');

		if ( !id ) {
			var noIdError = new Error('Spreadsheet Key not specified');
			noIdError.statusCode = 404;
			job.fail( noIdError );
			return;
		}

		job.set('type', 'json');

		var sheetNames = ['elements', 'slideshows', 'options'];

		this.api.spreadsheet( id ).fetchSheetDataListFeed(sheetNames, function( err, sheets ) {
			if ( err ) {
				job.fail( err );
				return;
			}

			if ( !sheets ) {
				var e = new Error('No Sheet Data Found');
				e.statusCode = 404;
				job.fail( e );
			}

			sheets.slideshows = covertSheetToMap(sheets.slideshows, 'key');

			var body = {
				elements: sheets.elements.map( processElement, sheets ),
				options: convertConfigSheet( sheets.options )
			};

			var cache = sheets.options['cache.expiry'] || job.get('cache');

			job.set('cache', cache );
			job.set( 'body', body );
			job.succeed();
		});

	}
});

function covertSheetToMap(sheet, keyColumn) {
	var result = {};

	(sheet || []).forEach(function (row) {
		var key = row[keyColumn];

		if (!result.hasOwnProperty(key)) {
			result[key] = [];
		}

		result[key].push(row);
	});

	return result;
}

function convertConfigSheet( sheet ) {
	var newSheet = {};
	sheet.forEach(function ( n, i ) {
		this[n.name] = n.value;
	}, newSheet);
	return newSheet;
}

function renameProperty( obj, from, to ) {
	if ( !obj || !obj.hasOwnProperty(from) ) {
		return obj;
	}

	var v = obj[from];
	delete obj[from];
	obj[to] = v;

	return obj;
}

function fudgeFuncDataValues( funcData ) {

	if ( typeof funcData['source'] !== 'undefined' && funcData.source === null ) {
		funcData.source = ' ';
	}

	if ( typeof funcData['title'] !== 'undefined' && funcData.title === null ) {
		funcData.title = ' ';
	}

	return funcData;
}

function processSlideshow ( n ) {
	fudgeFuncDataValues( n );
	return n;
}

function processElement( element ) {

	renameProperty(element, 'progressmarker', 'progressMarker');
	renameProperty(element, 'sendtorail', 'sendToRail');
	renameProperty(element, 'appendtorail', 'appendToRail');
	renameProperty(element, 'funcdata', 'funcData');
	renameProperty(element, 'transformin', 'transformIn');
	renameProperty(element, 'startx', 'startX');
	renameProperty(element, 'starty', 'startY');
	renameProperty(element, 'endx', 'endX');
	renameProperty(element, 'endy', 'endY');

	renameProperty(element.transformIn, 'startwidth', 'startWidth');
	renameProperty(element.transformIn, 'startheight', 'startHeight');
	renameProperty(element.transformIn, 'endwidth', 'endWidth');
	renameProperty(element.transformIn, 'endheight', 'endHeight');
	renameProperty(element.transformIn, 'fromcenter', 'fromCenter');

	renameProperty(element.details, 'touchesoverlayborder', 'touchesOverlayBorder');

	// checking for the presence of single space string? really?
	if ( typeof element['funcData'] !== 'undefined' ) {
		fudgeFuncDataValues(element.funcData);
	}

	if ( /^userInvokeCarousel:[a-zA-Z0-9]+/.test(element.func) && typeof element['funcData'] !== 'undefined' ) {
		var pair = element.func.split(':');

		element.func = pair[0];

		if (this.slideshows.hasOwnProperty(pair[1])) {
			element.funcData = this.slideshows[pair[1]].map(processSlideshow);
		}
	}

	return element;
}


module.exports = new ImpPlugin();
