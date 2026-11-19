#!/bin/sh
set -eu
: "${REDIS_PASSWORD:?Set a random alphanumeric password of at least 32 characters}"
case "$REDIS_PASSWORD" in *[!a-zA-Z0-9]*) echo 'REDIS_PASSWORD must be alphanumeric' >&2; exit 1;; esac
[ "${#REDIS_PASSWORD}" -ge 32 ] || { echo 'REDIS_PASSWORD is too short' >&2; exit 1; }
umask 077
config=$(mktemp /tmp/signalgen-redis.XXXXXX)
printf 'bind 0.0.0.0 -::\nport 6379\nprotected-mode yes\nrequirepass %s\nmaxmemory 64mb\nmaxmemory-policy allkeys-lru\nmaxclients 64\nsave ""\nappendonly no\n' "$REDIS_PASSWORD" > "$config"
exec redis-server "$config"
