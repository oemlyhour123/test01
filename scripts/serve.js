/* ==========================================================================
   RRMS — zero-dependency local preview server
   Usage: node scripts/serve.js [port]
   Serves the project root on http://localhost:8080 (default).
   ========================================================================== */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');

var root = path.resolve(__dirname, '..');
var port = Number(process.argv[2]) || 8080;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.sql': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

var server = http.createServer(function (req, res) {
  var pathname = decodeURIComponent(url.parse(req.url).pathname || '/');
  var relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  var filePath = path.resolve(root, relative);

  if (filePath !== root && filePath.indexOf(root + path.sep) !== 0) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, function (statError, stats) {
    if (statError) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found: ' + pathname);
      return;
    }

    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    fs.readFile(filePath, function (readError, buffer) {
      if (readError) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found: ' + pathname);
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(buffer);
    });
  });
});

server.listen(port, function () {
  console.log('RRMS preview: http://localhost:' + port);
  console.log('Press Ctrl+C to stop.');
});
