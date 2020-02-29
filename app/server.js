var express = require('express');
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server);

const bot = require('../bot');


app.use(express.static(__dirname + '/node_modules'));
app.get('/', function(req, res,next) {
	res.sendFile(__dirname + '/index.html');
});


io.on('connection', function(CLIENT) {
	console.log('Client connected...');

	CLIENT.on('startBot', function(CONFIG) {
		bot.start(CLIENT, CONFIG);
	});

	CLIENT.on('stopBot', function(data) {
		bot.stop(CLIENT);
	});


	CLIENT.on('messages', function(data) {
		console.log('SERVER messages', data);
		CLIENT.emit('broad', data);
		CLIENT.broadcast.emit('broad',data);
	});

});


server.listen(3000);
