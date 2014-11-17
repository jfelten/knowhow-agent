var zlib = require('zlib');
var fstream = require('fstream');
var tar = require('tar');
var logger=require('./routes/log-control').logger;

exports.packAgent = function(outputPath, callback) {

	var agent = this.agent;
	//create agent archive
	logger.info('packaging agent');
	fstream.Reader({ 'path': __dirname , 'type': 'Directory' }) /* Read the source directory */
	.pipe(tar.Pack()) /* Convert the directory to a .tar file */
	.pipe(zlib.Gzip()) /* Compress the .tar file */
	.pipe(fstream.Writer({ 'path': outputPath }).on("close", function () {
		logger.info('agent packaged.');
	}).on("error",function(){
		if (this.agent) {
			eventEmitter.emit('agent-error', agent);
		}
		logger.error('error packing agent: ', err);
		if (callback) {
			callback(new Error("Unable to pack agent"));
		}
	})).on("close", function () {
		if (callback) {
			callback();
		}
	});
	
};

exports.startAgent = function() {
	require('agent');
}