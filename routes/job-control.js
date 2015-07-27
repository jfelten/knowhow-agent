
var EventEmitter = require('events').EventEmitter;
var jobQueue = {};
var agentInfo;
var logger=require('./log-control').logger;
var pathlib=require("path");
var ss = require('socket.io-stream');
var mkdirp = require('mkdirp');
var zlib = require('zlib');
var tar = require('tar');
var domain = require('domain');
var eventEmitter=new EventEmitter();


//constants
var WORKING_DIR_VAR = "working_dir"

exports.jobQueue=jobQueue;
var jobInProgress = undefined;

completeJob = function(job) {
	if (job != undefined) {
		logger.info('completed job: '+job.id);
		delete jobQueue[job.id];
		jobInProgress = undefined;
		eventEmitter.emit('upload-complete',job);
	}

}

updateJob = function(job) {
	if(jobQueue[job.id]) {
		eventEmitter.emit('job-update',job);
		jobQueue[job.id] = job;
	}
	//logger.debug('updated:');
};

initiateJob = function(job, callback) {
		

	if (jobInProgress) {
		logger.debug("job already in progress");
		callback(new Error("job already exists"));
		return;
	}
	try {
		logger.info("initializing: "+job.id);
		jobInProgress = job.id;
		job.fileProgress = {};
		jobQueue[job.id] =job;
		job.totalFileSize=0;
		//check for relative paths and substitute working directory path

		if (job.working_dir) {
			job.working_dir = pathlib.resolve(job.working_dir);
		}

		job.status="initialized";
		//jobQueue[job.id]=job;
		logger.debug("job id:"+job.id+" initialized using working directory: "+job.working_dir);
		updateJob(job);
		callback(undefined, job);
	} catch (err) {
		logger.error(err.stack);
		logger.error("unable to initialize job: "+job.id);
		logger.error(err);
		callback(err, job)
		
	}
};

var cancelJob = function(job) {
	jobInProgress = undefined;
	logger.debug("starting cancel for: "+job.id);
	if (job) {
		if (job.fileProgress != undefined) {
			for (fileUpload in job.fileProgress) {
				fileProgress = job.fileProgress[fileUpload];
				if (fileProgress != undefined) {
					fileProgress.error = true;
				}
			}	
		}
		job.error = true;
		job.progress=0;
		updateJob(job);
		if (jobQueue[job.id] && jobQueue[job.id].knowhowShell && jobQueue[job.id].knowhowShell.cancelJob) {
		    logger.info("clearing knowhow-shell");
			jobQueue[job.id].knowhowShell.cancelJob(job);
		}
		logger.info('canceling job: '+job.id);
		job.progress=0;
		eventEmitter.emit('job-cancel', job);
		eventEmitter.emit('upload-complete',job);
		jobQueue[job.id] = undefined;
		jobInProgress = undefined;
	}
	
}

exports.cancelJob=cancelJob;

execute = function(job, agentInfo, serverInfo, callback) {

	var d = domain.create();
	
	d.on('error', function(er) {
	      logger.error('execution error', er.stack);
	      job.status="Error "+er.message;
		  cancelJob(job);	
	});
	d.run(function() {
		logger.info("executing: "+job.id+" "+agentInfo);
		console.log(agentInfo);
		initiateJob(job, function(err,job) {
			if (err) {
				logger.error(err);
			    if (job) {
					job.status="Error Initializing job";
					cancelJob(job);
					//callback(err,job);
				} 
				callback(err,job);
				return;
			}
			callback(undefined,job);
			waitForFiles(job, function(err, job) {
				if (err) {
					job.status="Error receiving required files";
					job.progress=0;
					job.error=true;
					cancelJob(job);	
					return;
				}
				logger.info("all files received - executing job");
				job.status="All files Received.";
				updateJob(job);
				if (!job.script.env) {
					job.script.env = {};
				}
				if (!job.env) {
					job.env={};
				}
				job.env.agent_host = agentInfo.host;
				job.env.agent_user = agentInfo.user;
				job.env.agent_password = agentInfo.password;
				job.env.agent_port = agentInfo.port;
				//var KnowhowShell = require('../../knowhow-shell');
				var KnowhowShell = require('knowhow-shell');
				jobQueue[job.id] = {};
				jobQueue[job.id].knowhowShell = new KnowhowShell(eventEmitter);
				console.log(job);
				jobQueue[job.id].knowhowShell.executeJobAsSubProcess(job, function(err, jobRuntime) {
					if(err) {
						if (jobRuntime)
							logger.error(job.id+" failed to execute: "+jobRuntime.output);
						job.status="Error "+err.message;
						cancelJob(job);	
						
					}
					//if (jobRuntime.output) {
					//	logger.debug(jobRuntime.output);
					//}
				});
				
			});
		
		});
	});
	
	
	
};

waitForFiles = function(job,callback) {
	
	var agent = this.agent;
    job.status = 'receiving files';
    updateJob(job);
    
    //timeout after x seconds
    timeoutms=600000;//default timeout of 10 minutes
    if (!job.options) {
		job.options = {};
	}
    if (job.options.timeoutms != undefined) {
    	
    	timeoutms=job.options.timeoutms;
    	logger.info("setting job timeout to: "+timeoutms);
    }
    
    if (job.files && job.files.length >0 ) {
	    var timeout = setTimeout(function() {
	    	logger.info("job: "+job.id+" file upload timed out.");
	    	clearInterval(fileCheck);
	    	job.status=(job.id+" required files not within timeout. Aborting...");
	    	eventEmitter.emit('upload-complete',job);
	    	callback(new Error("file upload timed out."),job);
	    }, timeoutms);
	    
	    var checkInterval = 5000; //5 second
	    //wait until all files are received
	    var lastProgress=1;
	    var numChecks = 0;
	    var fileCheck = setInterval(function() {
	    
	        var updatedJob = jobQueue[job.id];
	    	if (updatedJob != undefined && (updatedJob.error == true || updatedJob.cancelled == true)) {
	    		logger.error(job.id+" has an error. Aborting...");
				clearTimeout(timeout);
				clearInterval(fileCheck);
				callback(new Error("Aborting job"), job);
				return;
	    	}
	    	numChecks++;
	    	if ( (job.status == "initialized" || job.status =="initializing")  && numChecks > 6) {
	    		logger.error(job.id+" upload failed to start. Aborting...");
	    		clearTimeout(timeout);
				clearInterval(fileCheck);
				callback(new Error("Aborting job"), job);
	    		return;
	    	}
	    	
	    	var numFilesUploaded=0;
	    	
	    	var totalUploaded=0;
	    	for (filename in job.fileProgress) {
	    		if (job.fileProgress[filename].uploadComplete != true && fs.existsSync(filename) ) {
	    		    var stat= fs.statSync(filename); 
		    		var fileSizeInBytes = stat["size"];
		    		logger.debug(filename+' size='+fileSizeInBytes+' correct size='+job.fileProgress[filename]['FileSize']);
		    		totalUploaded+=fileSizeInBytes;
		    		job.fileProgress[filename]['Uploaded'] = fileSizeInBytes;
			    	if(job.fileProgress[filename]['error'] == true) {
			    		logger.error("problem receiving: "+filename+" cancelling job: "+job.id);
			    		cancelJob(job)
			    	} else if(fileSizeInBytes === job.fileProgress[filename]['FileSize']) {
			    		job.fileProgress[filename].uploadComplete=true;
			    		if (job.fileProgress[filename].fileWriter) {
			    			job.fileProgress[filename].fileWriter.close();
			    		}
			    		eventEmitter.emit('file-uploaded',job.id, job.fileProgress[filename].name);
			    		updateJob(job);
			    	} 

	    		    		
	    		} else if (job.fileProgress[filename].uploadComplete == true) {
	    			totalUploaded+=job.fileProgress[filename]['FileSize']
	    			numFilesUploaded++;
	    		}
	    		
	    		
	    	}
	    	if (numFilesUploaded >= Object.keys(job.files).length) {
    			clearTimeout(timeout);
    			clearInterval(fileCheck);
    			logger.info("upload complete: num files received="+numFilesUploaded+" expected: "+Object.keys(job.fileProgress).length);
    			eventEmitter.emit('upload-complete',job);
    			callback(undefined, job);
    		}  else if ((jobQueue[job.id] && jobQueue[job.id].disconnected == true )|| !jobInProgress) {
    			logger.info(job.id+" did not receive all files. - Aborting...");
    			clearTimeout(timeout);
    			clearInterval(fileCheck);
    			//eventEmitter.emit('upload-complete',job);
    			callback(new Error("server disconnected before upload complete"), job);
    		}
	    	
	    	job.progress=Math.ceil((totalUploaded/job.totalFileSize)*100)
            if (job.progress > lastProgress ) {
            	lastProgress=job.progress;
            	updateJob(job);
            	logger.debug("progress: "+totalUploaded+" of "+job.totalFileSize+"  %done:"+job.progress);
            	
            }
    		logger.debug(numFilesUploaded+ " of "+Object.keys(job.fileProgress).length+" files received.");
	    }, checkInterval);
	} else {
		callback(undefined, job);
	}
    
    
};

JobControl = function(io) {

	//logger.info('setting event io to:'+io);
	this.io = io;
	
	this.socket = undefined;
	this.jobQueue=jobQueue;
	this.cancelJob = cancelJob.bind({eventEmitter: this.eventEmiter});;
	this.execute = execute.bind({eventEmitter: this.eventEmiter});
	
	eventEmitter.on('upload-complete', function(job) {
			logger.debug("sending upload complete to server");
			if (this.socket) {
				this.socket.emit('End', job );
			}
			
		});
	eventEmitter.on('file-uploaded', function(jobId, filename) {
					
	});
	return this;
};



//var io = require('socket.io').listen(server)
JobControl.prototype.initiateJob  = initiateJob ;
JobControl.prototype.execute = execute;
JobControl.prototype.eventEmitter = eventEmitter;
JobControl.prototype.registerServer = function registerAgent(server) {
	  logger.info(server);
	  this.serverInfo=server;
	};
JobControl.prototype.jobQueue = jobQueue;