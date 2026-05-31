#!/usr/bin/env python3
import os, sys
os.chdir('/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web')
import http.server, socketserver
PORT = 7788
with socketserver.TCPServer(("", PORT), http.server.SimpleHTTPRequestHandler) as httpd:
    httpd.serve_forever()
