var express = require('express');
var http = require('http');
var opt = require('optimist');
var path = require('path');

var argv = require('optimist')
	.options({
		'port': {
			'description': 'Server port',
			'default': 8080
		},
		'content': {
			'description': 'Content server root',
			'default': 'localhost:9000'
		}
	})
	.argv;

if (argv.h || argv.help) {
	opt.showHelp();
	return;
}

function main() {
	var app = express();

	app.set('views', path.join(__dirname, '..', 'template'));
	app.set('view engine', 'ejs');

	app.use(express.static(path.join(__dirname, '..', 'public')));
	app.use(function (req, res, next) {
		res.locals.content = argv.content;
		res.render('index');
	});

	var server = http.createServer(app);
	server.listen(argv.port, function () {
		console.log('Web server is now listening on port', server.address().address, server.address().port);
	});

	return server;
}

main();
