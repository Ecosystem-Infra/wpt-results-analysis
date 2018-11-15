lib/wpt_pb.js: wpt.proto
	protoc --js_out=import_style=commonjs,binary:lib wpt.proto
