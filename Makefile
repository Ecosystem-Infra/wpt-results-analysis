gen/wpt_pb.js: wpt.proto
	mkdir -p gen && protoc --js_out=import_style=commonjs,binary:gen wpt.proto
