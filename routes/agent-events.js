var logger=require('./log-control').logger;

var io;
var eventEmitter;
var serverInfo;

var connectedSockets = [];


function configureEventSocket(socket, nextIndex, jobControl) {

	var self=this;
	self.jobControl = jobControl;
    console.log("jobControl="+jobControl);
	socket.on('disconnect',function(err) {
	 	logger.info("removing listeners");
	 	delete connectedSockets[nextIndex];
	 });
		
	
	socket.on('job-cancel', function(job) {
		logger.info("cancel requested by server for: "+job.id);
		self.jobControl.cancelJob(job);
			//socket.emit('job-cancel', job);
	});

}

/**
 * opens an event socket to an knowhow-server
 */
var openEventSocketToServer = function(serverInfo) {
	var nextIndex = connectedSockets.length;
	 var eventSocket = require('socket.io-client')('http://'+serverInfo.host+':'+serverInfo.port+'/agent-events');
	 eventSocket.open();
	 configureEventSocket(eventSocket, nextIndex, this.jobControl);
	 
	 //var fileSocket = require('socket.io-client')('http://'+serverInfo.host+':'+serverInfo.port+'/agent-file');
	 //fileSocket.open();
}

/**
 * listens for and registers new incoming socket connections
 *
 */
var listenForIncomingEventSockets = function(io, jobControl) {
	var eventListener = io.of('/agent-events');
	var nextIndex = connectedSockets.length;
	
	eventListener.on('connection', function (socket) {
		logger.info('new event listener connected');
		connectedSockets.push(socket);
		
		configureEventSocket(socket, nextIndex, jobControl);
		

		

	});
};
	
function sendJobEventToServer(eventType, job) {
	//logger.debug("emitting "+eventType+" event.");
	if (job) {
		for (var i=0; i<connectedSockets.length; i++) {
			var socket = connectedSockets[i];
			if (socket) {
				try {
					socket.emit(eventType, {id: job.id, progress: job.progress, status: job.status});
				} catch (err) {
					logger.error(err.stack);
				}
			} else {
				logger.error("invalid event socket");
			}
		}
	}
}

function sendExecutionEventToServer(eventType, command) {
	if (command) {
		for (var i=0; i<connectedSockets.length; i++) {
			var socket = connectedSockets[i];
			if (socket) {
				try {
					socket.emit(eventType, agent);
				} catch( err) {
					logger.err(err.stack);
				}
			}
		}
	}
}

function sendAgentEventToServer(eventType, agent) {
	if (agent) {
		for (var i=0; i<connectedSockets.length; i++) {
			var socket = connectedSockets[i];
			if (socket) {
			try {
					socket.emit(eventType, agent);
				} catch( err) {
					logger.err(err.stack);
				}
			}
		}
	}
}
	

AgentEventHandler = function(io, agentControl, jobControl) {
	logger.info('setting event io to:'+io);
	this.io = io;
	this.eventEmitter = agentControl.eventEmitter;
	logger.info("eventEmitter="+this.eventEmitter);
		
		jobControl.eventEmitter.on('execution-start', function(command) {
			if (command) {
				//logger.debug(command);
				//socket.emit('job-update', job);
				sendExecutionEventToServer('execution-start',  command);
			}
		});
		
		jobControl.eventEmitter.on('execution-complete', function(command) {
			if (command) {
				//logger.debug(command);
				//socket.emit('job-update', job);
				sendExecutionEventToServer('execution-complete',  command);
			}
		});
		
		jobControl.eventEmitter.on('execution-error', function(command) {
			if (command) {
				//logger.debug("execution complete event");
				//socket.emit('job-update', job);
				sendExecutionEventToServer('execution-error', command);
			}
		});
		
		jobControl.eventEmitter.on('execution-password-prompt', function(command) {
			if (command) {
				//logger.debug("execution password prompt event");
				//socket.emit('job-update', job);
				sendExecutionEventToServer('execution-password-prompt', command);
			}
		});
		jobControl.eventEmitter.on('execution-output', function(output) {
			if (output) {
				//logger.debug("execution output event "+ output);
				//socket.emit('job-update', job);
				sendExecutionEventToServer('execution-output', output);
			}
		});
		
		jobControl.eventEmitter.on('job-update', function(job) {
			if (job) {
				//logger.debug("emit job-update");
				//socket.emit('job-update', job);
				sendJobEventToServer('job-update',  {id: job.id, status: job.status, message: job.message});
			}
		});
		
		jobControl.eventEmitter.on('job-error', function(job) {
			if (job) {
				//logger.debug("job error: "+job.id);
				//socket.emit('job-error', job);
				jobControl.cancelJob(job);
				sendJobEventToServer('job-error', {id: job.id, status: job.status, message: job.message});
			}
		});
		
		jobControl.eventEmitter.on('job-complete', function(job) {
			if (job) {
				//logger.debug("job complete event: "+job.id);
				completeJob(job);
				//socket.emit('job-complete', job);
				sendJobEventToServer('job-complete', {id: job.id, status: job.status, message: job.message});
			}
		});
		
		jobControl.eventEmitter.on('job-cancel', function(job) {
			logger.info("sending cancel message to server for: "+job.id);
			//socket.emit('job-cancel', jobId);
			sendJobEventToServer('job-cancel', {id: job.id, status: job.status, message: job.message});
		});
		
		agentControl.eventEmitter.on('agent-update', function(agent) {
			if (agent) {
				agentControl.updateAgent(agent);
				//socket.emit('agent-update',agent);
				sendAgentEventToServer('agent-update', agent);
			}
			
		});

		agentControl.eventEmitter.on('agent-error', function(agent) {

			if (agent) {
				logger.info('agent error detected.');
				agent.progress = 0;
				agentControl.updateAgent(agent);
				agent.status='ERROR';
				//socket.emit('agent-error',agent);
				sendAgentEventToServer('agent-error', agent);
			}
			
		});

	   	agentControl.eventEmitter.on('agent-delete', function(agent) {
	   		if (agent) {
				agent.status='DELETED';
				//socket.emit('agent-delete',agent);
				sendAgentEventToServer('agent-delete', agent);
			
			}
		});
		agentControl.eventEmitter.on('agent-add', function(agent) {
			if (agent) {
				agent.status='INSTALLING';
				//socket.emit('agent-add',agent);
				sendAgentEventToServer('agent-add', agent);
			}
		});
	
	listenForIncomingEventSockets(io,jobControl)
	this.openEventSocketToServer = openEventSocketToServer.bind({jobControl: jobControl});
	
	return this;
	
}



AgentEventHandler.prototype.registerServer = function registerAgent(server) {
  logger.info(server);
  	this.serverInfo=server;
};

AgentEventHandler.prototype.serverInfo = serverInfo;
AgentEventHandler.prototype.eventEmitter = eventEmitter;


module.exports = AgentEventHandler;
