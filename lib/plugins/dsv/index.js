var Plugins = require('../plugin.js'),
  googleSpreadsheets = require('../../google/googlespreadsheet.js'),
  GssUtils = require('../../google/gssUtils.js'),
  d3 = require('d3'),
  _ = require('lodash');


var DSVPlugin = Plugins.sub('DSVPlugin', {

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

    var sheetNames = sheetName.split(','),
      opts = GssUtils.pluckOptions( job );


    if (sheetNames.length > 1) {
      var tooManySheetsError = new Error('Too many sheets. The DSV Plugin can only process a single sheet.\n\t' + sheetNames.length + 'sheets were specified.\n\t' + sheetNames.join(', '));
      tooManySheetsError.statusCode = 404;
      job.fail( tooManySheetsError );
      return;
    }

    var firstSheetName = sheetNames[0];

    if (!firstSheetName) {
      var nullSheetNameError = new Error('The sheet name specified is not valid because it is null');
      nullSheetNameError.statusCode = 404;
      job.fail( nullSheetNameError );
      return;
    }


    var fileType = firstSheetName.match(/[A-Za-z0-9\-\+]\.(csv|tsv)$/i);

    if (!fileType || fileType.length < 2) {
      var noFileTypeError = new Error('You must specify a file type extension. Either \'csv\' or \'tsv\'. Example: ' + firstSheetName + '.csv');
      noFileTypeError.statusCode = 404;
      job.fail( noFileTypeError );
      return;
    }

    fileType = fileType[1];
    firstSheetName = firstSheetName.replace(new RegExp('\.' + fileType + '$', 'i'), '');
    fileType = fileType.toLowerCase();

    this.api.spreadsheet( id ).fetchSheetDataListFeed([firstSheetName], opts, function( err, sheets ) {
      if ( err ) {
        job.fail( err );
        return;
      }

      if ( !sheets ) {
        var e = new Error('No Sheet Data Found');
        e.statusCode = 404;
        job.fail( e );
        return;
      }

      var firstSheet = sheets[firstSheetName];

      if (!firstSheet) {
        var fse = new Error('Data for ' + firstSheetName + ' not found');
        fse.statusCode = 404;
        job.fail( fse );
        return;
      }

      var body = '';

      try {
        body = d3[fileType].format(sheets[firstSheetName]);
      } catch (formatErr) {
        formatErr.statusCode = 404;
        job.fail( formatErr );
        return;
      }

      job.set('type', fileType);
      job.set( 'body', body );
      job.succeed();
    });

  }
});

module.exports = new DSVPlugin();
