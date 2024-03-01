/**
* First make sure you have converted the `.p12` file (downloaded from the Google Developer console) in a `.pem` using this command:
*
* ```shell
* $ openssl pkcs12 -in key.p12 -passin pass:notasecret -nodes -legacy -out key.pem
* ```
*/

var fs = require('fs');
var path = require('path');
var pemFile = process.argv.filter(function(element) {
  return /\.pem$/.test(element);
})[0];

if (!pemFile) {
  console.error('Pem file location is required');
  return;
}

var fullpath = path.resolve(process.cwd(), pemFile);
var content = fs.readFileSync(fullpath).toString();

process.stdout.write(content.replace(/\n/g, "\\n").replace(/\r/g, "\\r"));
