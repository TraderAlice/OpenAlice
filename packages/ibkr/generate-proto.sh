#!/bin/bash
# Generate TypeScript bindings from IBKR .proto files
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROTO_DIR="$SCRIPT_DIR/ref/source/proto"
OUT_DIR="$SCRIPT_DIR/src/protobuf"
PLUGIN="$SCRIPT_DIR/node_modules/.bin/protoc-gen-ts_proto"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

protoc \
  --plugin="protoc-gen-ts_proto=$PLUGIN" \
  --ts_proto_out="$OUT_DIR" \
  --ts_proto_opt=esModuleInterop=true \
  --ts_proto_opt=outputTypeRegistry=false \
  --ts_proto_opt=useExactTypes=false \
  --ts_proto_opt=importSuffix=.js \
  --proto_path="$PROTO_DIR" \
  "$PROTO_DIR"/*.proto

echo "Generated $(ls "$OUT_DIR"/*.ts 2>/dev/null | wc -l | tr -d ' ') TypeScript files in $OUT_DIR"
