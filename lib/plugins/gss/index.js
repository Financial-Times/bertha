var Plugins = require('../plugin.js'),
	googleSpreadsheets = require('../../google/index.js'),
	_ = require('lodash');


var GSSPlugin = Plugins.sub('GSSPlugin', {

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

		var sheetName = job.get('sheet');

		if ( !sheetName ) {
			var noSheetError = new Error('Worksheet Name not specified');
			noSheetError.statusCode = 404;
			job.fail( noSheetError );
			return;
		}

		job.set('type', 'json');
		job.set('cache', job.get('cache'));

		var sheetNames = sheetName.split(',');
		const start = Date.now();
		this.api.spreadsheet( id ).fetchSheetDataListFeed(sheetNames, function( err, sheets ) {
			const duration = Date.now() - start;
			if ( err ) {
				err.duration = duration;
				job.fail( err );
				return;
			}
			
			if ( !sheets ) {
				var e = new Error('No Sheet Data Found');
				e.statusCode = 404;
				e.duration = duration;
				job.fail( e );
				return;
			}

			var firstSheetName = sheetNames[0].replace(/^\+/, ''); // in case it's optional
					singleSheetMode = sheetNames.length === 1;

			var body = singleSheetMode ? (sheets.hasOwnProperty(firstSheetName) ? sheets[firstSheetName] : []) : sheets;

			var cache = job.get('cache') || 0;

			job.set('cache', cache );
			job.set( 'body', body );
			job.succeed();
		});

	}
});

module.exports = new GSSPlugin();
