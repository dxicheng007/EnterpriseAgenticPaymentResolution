#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update
sudo apt-get install -y curl ca-certificates gnupg
sudo install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | sudo gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
. /etc/os-release
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt-get update
sudo apt-get install -y postgresql-18

pg_bin=/usr/lib/postgresql/18/bin
echo "$pg_bin" >> "$GITHUB_PATH"
export PATH="$pg_bin:$PATH"

command -v pg_ctl
command -v initdb
postgres --version
