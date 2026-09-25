#!/bin/zsh -l
cd -- "$(dirname -- "$0")" || exit 1
exec node server.mjs
