#!/usr/bin/env bash

rm -rf ./launcher.log && rm -rf tmp && node ./dist/index.js spawn --provider native ./chain_specs/my-network.toml &> ./launcher.log &

# sudo lsof -i -P -n | grep LISTEN