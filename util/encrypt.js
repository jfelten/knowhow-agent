

var crypto = require('crypto');
var defaultKey = 'd6F3Efea';

var encrypt = function(text, cryptoKey){
	var cipher = crypto.createCipher('aes-256-cbc',cryptoKey)
	var crypted = cipher.update(text,'utf8','hex')
	crypted += cipher.final('hex');
	return crypted;
}
 
var decrypt = function(text, cryptoKey){
	var decipher = crypto.createDecipher('aes-256-cbc',cryptoKey)
	var dec = decipher.update(text,'hex','utf8')
	dec += decipher.final('utf8');
	return dec;
}

exports.defaultKey = defaultKey;
exports.encrypt = encrypt;
exports.decrypt = decrypt;