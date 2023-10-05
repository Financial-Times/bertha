var fields = ['plugin', 'spreadsheet', 'sheet', 'cache', 'sort', 'query', 'd', 'd2'];

const badCharacters = /[[\]{}`'":/*%\!\\<>;*%&\?]/gm
const nonPrintableCharacters = /[^\x20-\x7E]+/g
function sanitiseInput (value) {
	if (typeof value !== 'string') {
		return ''
	}
	return decodeURIComponent(decodeURIComponent(value))
		.replace(badCharacters, '')
		.replace(badCharacters, '')
		.replace(nonPrintableCharacters, '')
}

var Message = {
	
	serialize: function( obj ) {
		return (sanitiseInput(obj.plugin) || '-') + ':' +
				(sanitiseInput(obj.spreadsheet).replace(/\s\r\n/gm,'') || '-') + ':' +
				(sanitiseInput(obj.sheet) || '-') + ':' +
				(sanitiseInput(obj.cache) || '-') + ':' +
				(sanitiseInput(obj.sort) || '-') + ':' +
				(sanitiseInput(obj.query) || '-') + ':' +
				(sanitiseInput(obj.d).replace(/\s\r\n/gm,'') || '-') + ':' +
				(sanitiseInput(obj.d2) || '-').toString();

	},

	deserialize: function( key ) {
		var o = {},
			f = key.split(':');

		f.forEach(function(e,i){
			o[fields[i]] = (e == '-') ? null : e;
		});

		return o;
	},

	fromRequest: function( request ) {
		return Message.serialize({
			plugin: request.params.plugin,
			spreadsheet: request.params.key,
			cache: request.query.exp,
			sheet: request.params.sheet,
			sort: request.query.sort,
			query: request.query.q,
			d: request.query.d,
			d2: request.query.d2,
		});
	}
};

module.exports = Message;
