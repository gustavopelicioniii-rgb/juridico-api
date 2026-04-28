#!/usr/bin/env sh
if [ -f "$(dirname -- "$0")/_/husky.sh" ]; then
  . "$(dirname -- "$0")/_/husky.sh"
else
  echo "husky.sh not found"
  exit 1
fi
