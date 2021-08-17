var Plugins = require('../plugin.js'),
	googleSpreadsheets = require('../../google/googlespreadsheet.js'),
	GssUtils = require('../../google/gssUtils.js'),
	_ = require('lodash');


var ProfilePlugin = Plugins.sub('ProfilePlugin', {

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
			noIdError.code = 404;
			job.fail( noIdError );
			return;
		}

		var presetName = job.get('sheet') || '';

		var otherSheets = presetName.split(',');

		presetName = otherSheets.shift();

		if (!presetName) {
			presetName = 'basic';
		}

		if ( !(presetName in spreadsheetPresets) ) {
			var noConfigError = new Error('Unknown Spreadsheet Configuration "' + presetName + '".');
			noConfigError.code = 404;
			job.fail( noConfigError );
			return;
		}

		job.set('type', 'json');

		var preset = spreadsheetPresets[presetName];

		var sheetNames = defaultSheets.concat(preset.sheets).concat(otherSheets),
				opts = GssUtils.pluckOptions( job );

		this.api.spreadsheet( id ).fetchSheetDataListFeed(sheetNames, opts, function( err, sheets ) {
			if ( err ) {
				job.fail( err );
				return;
			}

			if ( !sheets ) {
				var e = new Error('No Sheet Data Found');
				e.code = 404;
				job.fail( e );
				return;
			}

			sheets.credits = convertCreditsSheet( sheets.credits );
			sheets.options = convertOptionsSheet( sheets.options );

			preset.transform(sheets, function (transformErr, body) {

				if (transformErr) {
					job.fail(transformErr);
					return;
				}

				var cache = body.options['cache.expiry'] || job.get('cache');

				job.set( 'cache', cache );
				job.set( 'body', body );
				job.succeed();

			});

		});
	}
});

var defaultSheets = ['+credits', '+options'];


var spreadsheetPresets = {
	'basic': {
		sheets: ['data'],
		transform: function(data, callback) {
			callback(null, data);
		}
	},
	'audioss': {
		sheets: ['slides'],
		transform: function(data, callback) {
			// TODO: AudioSlideshow logic
			callback(null, data);
		}
	},
	'timelines': {
		sheets: ['slides', '+groups'],
		transform: function(data, callback) {
			// TODO: Timeline logic
			callback(null, data);
		}
	},
	'profiles': {
		sheets: ['slides', '+groups'],
		transform: function(data, callback) {

			// var optionNames = _keys(data.options),
			// 		groupConfigNames = _.compact(optionNames.map(function (optName) {
			// 			return /^sheets\.groups\.\w+\.name$/.test(optName) ? data.options[optName] : null
			// 		})),
			// 		groupsConfig = {};

			// if( !groupConfigNames.length ) {
			// 	groupConfigNames = ['groups'];
			// }

			// groupConfigNames.forEach(function (name) {
			// 	groupsConfig[name] = {
			// 		name: name,
			// 		join: data.options['sheets.groups.' + name + '.join'] || 'groups'
			// 	};
			// });

			// if there are options for sheet.groups.*.name then we are not using
			// if there is an option for sheets.groups then we need to be looking for that for grouping
			// if there is a groups sheet then treat it as a standard many-to-one/many-to-many spreadsheets



			// set default options
			// read any options to convert the data?
			// validate the data
			// do any conversions
			// add special dynamic columns

			// var groups = [],
			// 		groupSheetOption = data.options['sheets.groups'];

			// // build a list of sheets that represent groups
			// if ( data.hasOwnproperty('groups') ) {
			// 	groups.push('groups');
			// } else if ( !!groupSheetOption ) {
			// 	if ( groupSheetOption instanceof Array ) {
			// 		groups = groups.concat(groupSheetOption);
			// 	} else {
			// 		groups.push(groupSheetOption)
			// 	}
			// }

			// // removes duplicates
			// groups = _.uniq(groups, false);

			// // ensure all those sheets exist and have data. remove if not.
			// groups = groups.map(function(group, indx){
			// 	return data.hasOwnproperty(group) && data[group].length;
			// });


			// groups = groups.map(function(group, indx) {

			// 	var groupData = data[group],
			// 			firstRowData = groupData[0] && groupData[0].data,
			// 			hasFieldColumn = !!firstRowData && firstRowData.hasOwnProperty('key') && firstRowData.hasOwnProperty('field');

			// 	if (hasFieldColumn) {
			// 		var vals = data[group].map(function(row){
			// 			return row.data.field;
			// 		});
			// 		return _.uniq(vals, false);
			// 	}

			// 	return group;

			// });

			// for each group sheet build a grouping

			callback(null, data);
		}
	}
};

function convertOptionsSheet( sheet ) {
	var newSheet = {};
	sheet && sheet.forEach(function (n, i) {
		var m = n.name;
		var v = n.value;
		var t = this[m];
		this[m] = this.hasOwnProperty(m)
											? (t instanceof Array ? t.push(n.value) : [t, v])
											: v;
	}, newSheet);
	return newSheet;
}

function convertCreditsSheet( sheet ) {
	var newSheet = sheet || [];
	// anything else to do here?
	return newSheet;
}

module.exports = new ProfilePlugin();
