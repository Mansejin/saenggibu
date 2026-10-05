#!/bin/sh
# Paste this ENTIRE file into DSM Task Scheduler (user: root).
# Do NOT run scripts/nas-docker-update.sh from the repo — that copy is stale.
#
# DSM -> Task Scheduler -> saenggibu-auto-pull -> Run command:
#   sh /volume1/docker/saenggibu/scripts/nas-dsm-task.sh
#
# First-time: copy this file via File Station or one SSH echo (see docs/deploy-nas-auto.md)

REPO="/volume1/docker/saenggibu"
LOG="$REPO/logs/scheduled-pull.log"
LOCK="/tmp/saenggibu-deploy.lock"
BRANCH="main"

mkdir -p "$REPO/logs"
export PATH="/usr/local/bin:/var/packages/ContainerManager/target/usr/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

if [ -f "$REPO/.env" ]; then
  line=$(grep -E '^SGB_DEPLOY_BRANCH=' "$REPO/.env" 2>/dev/null | tail -n 1 || true)
  if [ -n "$line" ]; then
    BRANCH=$(echo "${line#SGB_DEPLOY_BRANCH=}" | tr -d '\r' | tr -d '"' | tr -d "'")
  fi
fi

if [ -f "$LOCK" ]; then
  age=$(( $(date +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || stat -f %m "$LOCK") ))
  if [ "$age" -lt 1800 ]; then
    exit 0
  fi
  rm -f "$LOCK"
fi
touch "$LOCK"
trap 'rm -f "$LOCK"' EXIT INT TERM

echo "=== $(date '+%Y-%m-%d %H:%M:%S') DSM task start branch=$BRANCH ===" >> "$LOG"

export SGB_BRANCH="$BRANCH"
export SGB_DOCKER_SUDO=1

if ! curl -fsSL "https://raw.githubusercontent.com/Mansejin/saenggibu/${BRANCH}/scripts/nas-docker-update.sh" \
  -o /tmp/sgb-deploy.sh >> "$LOG" 2>&1; then
  echo "ERROR: curl deploy script failed" >> "$LOG"
  exit 1
fi

sed -i 's/\r$//' /tmp/sgb-deploy.sh 2>/dev/null || true
cd "$REPO" || exit 1
sh /tmp/sgb-deploy.sh >> "$LOG" 2>&1
rc=$?
echo "=== $(date '+%Y-%m-%d %H:%M:%S') DSM task end exit=$rc ===" >> "$LOG"
exit $rc
