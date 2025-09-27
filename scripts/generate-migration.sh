#!/bin/bash
NAME=$1
npx typeorm-ts-node-commonjs migration:generate ./src/migrations/$NAME -d src/data-source.ts
