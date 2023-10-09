const SheetReader = require('@financial-times/sheet-reader');

const options = {
	columnKeys: 'legacy',
};

const auth = {
	key: process.env.GOOGLE_SERVICE_KEY.replace(/\\n/g, '\n'),
	email: process.env.GOOGLE_CLIENT_EMAIL,
	subject: process.env.GOOGLE_USER,
};

function GoogleSpreadsheets() {

	const instance = SheetReader({ auth });

	function spreadsheet(spreadsheetId) {

		function fetchSheetDataListFeed(sheetNames, callback) {
			instance.fetchSheetWithCallback(spreadsheetId, sheetNames, options, callback);
		}

		return {
			fetchSheetDataListFeed,
			sheetsByName: {}, // deprecated property
		}
	}

	return {
		spreadsheet
	}
}

module.exports = function () {
	return GoogleSpreadsheets();
};