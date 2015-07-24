var ss = require('socket.io-stream');
var logger=require('./log-control').logger;
var fileControl = require('./file-control');

var fileSockets = [];

/**
 * opens an file socket to an knowhow-server
 */
var openFileSocketToServer = function(serverInfo) {
	 var fileSocket = require('socket.io-client')('http://'+serverInfo.host+':'+serverInfo.port+'/agent-file');
	 fileSocket.open();
	 fileSockets.push(fileSocket);
	 configureFileSocket(fileSocket,this.eventEmitter,this.jobQueue);
}

/**
 * listens for incoming files socket requests
 *
 * io from the main web server
 */
 var listenForFileSocketConnections = function(io, eventEmitter, jobQueue) {
 	var up = io.of('/upload');

	up.on('connection', function (socket) {
		this.socket=socket;
		logger.info('agent upload connection');
		configureFileSocket(socket,eventEmitter, jobQueue);
		fileSockets.push(socket);
	});
 
 }
 
 /**
  * configures a file socket
  *
  * @param socket the socket to condigure
  */
var configureFileSocket = function(socket, eventEmitter, jobQueue) {
			
	ss(socket).on('agent-upload', {highWaterMark: 32 * 1024}, function(stream, data) {
	    
	    var jobId = data['jobId'];
		var job = jobQueue[jobId];
		var lastProgress=1;
		if (job == undefined) {
			socket.emit('Error', {message: 'No active Job with id: '+jobId, jobId: jobId, name: data.name} );
			eventEmitter.emit('job-error',job);
			return;
		} else if (job.error == true || job.cancelled == true) {
			socket.emit('Error', {message: 'Invalid Job with id: '+jobId, jobId: jobId, name: data.name} );
			eventEmitter.emit('job-error',job);
			return;
		}
		
        job.status="receiving files."
        job.progress=(job.progress)+1;
        updateJob(job);
		
		try {
			fileControl.forkStream (stream, data.destination, function(err, streams) {
				logger.debug("forked: "+  data.name+" into "+streams.length+" streams.");
				for (fileStream in streams) {
					
					var dest = streams[fileStream].destination;
					if (job.script && job.script.env) {
						job.script.env.working_dir= job.working_dir;
						dest = fileControl.replaceVars(streams[fileStream].destination, job.script.env);
					}
					logger.debug("saving: "+ data.name+" to "+dest+" dontUpload="+job.options.dontUploadIfFileExists);
					var overwrite = (job.options && job.options.dontUploadIfFileExists!=true);
					var isDirectory = data['isDirectory']
					fileControl.saveFile(streams[fileStream].stream, data.name, data.fileSize, dest, socket, overwrite, isDirectory, job);
				}
			});
		} catch(err) {
			socket.emit('Error', {message: 'Unable to save: '+data.name+' for job: '+jobId, jobId: jobId, name: data.name} );
			logger.error(err.message);
			logger.error(err.stack);
			job.message = 'upload error: '+data.name;
			eventEmitter.emit('job-error',job);
			return;
		}
	       
	});
		
	socket.on('client-upload-error', function(data) {
	    var jobId = data['jobId'];
		logger.error('Problem uploading: '+data.name+' for job: '+jobId);
		logger.error('Cancelling job: '+jobId);
		var job = jobQueue[jobId];
		if (job == undefined) {
			socket.emit('Error', {message: 'No active Job with id: '+jobId} );
			return;
		}
		cancelJob(job);
		socket.emit('End',{message: 'job cancelled: ',jobId: jobId, fileName: data.name});
	});
	socket.on('disconnect', function(err) {
		logger.debug("upload connection ended.");
		for (index in jobQueue) {
			if (jobQueue[index]) {
				jobQueue[index].disconnected = true;
			}
		}
			
	});
	
	socket.on('error', function(err) {
		logger.error("socket error");
		logger.error(err);
	});

} 


FileUploadControl = function(io, jobControl) {
	var self = this;
	self.io = io;
	self.eventEmitter = jobControl.eventEmitter;
	self.jobQueue = jobControl.jobQueue;
	
	self.listenForFileSocketConnections = listenForFileSocketConnections.bind({jobQueue: self.jobQueue, eventEmitter: self.eventEmitter});
	self.openFileSocketToServer = openFileSocketToServer.bind({jobQueue: self.jobQueue, eventEmitter: self.eventEmitter});
	
	//listen for incoming connections
	self.listenForFileSocketConnections(self.io,self.eventEmitter,self.jobQueue);
	
	return self;
}

module.exports = FileUploadControl;