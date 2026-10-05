#!/bin/sh
# Synology NAS: git pull + docker compose rebuild
#
# Usage:
#   cd /volume1/docker/saenggibu && sh scripts/nas-docker-update.sh
#   cd /volume1/docker/saenggibu && sh scripts/nas-docker-update.sh --logs-only
#   cd /volume1/docker/saenggibu && sh scripts/nas-docker-update.sh --no-build
#   cd /volume1/docker/saenggibu && sh scripts/nas-docker-update.sh --pull-only
#
# Branch: SGB_BRANCH=main sh scripts/nas-docker-update.sh
#        (or set SGB_DEPLOY_BRANCH in .env)
# Sudo:   SGB_DOCKER_SUDO=1 sh scripts/nas-docker-update.sh
# Repo:   SGB_REPO_DIR=/volume1/docker/<dir> (default /volume1/docker/saenggibu)
# Names:  container names come from .env (SGB_API_CONTAINER, SGB_GATEWAY_CONTAINER,
#         SGB_TUNNEL_CONTAINER) — same keys docker-compose*.yml read.

set -e

REPO_DIR="${SGB_REPO_DIR:-/volume1/docker/saenggibu}"
if [ -d "$REPO_DIR" ]; then
  REPO_DIR=$(cd "$REPO_DIR" && pwd -P)
fi
GIT_IMAGE="alpine/git:latest"
LOGS_ONLY=0
NO_BUILD=0
PULL_ONLY=0
FORCE_BUILD=0

for arg in "$@"; do
  case "$arg" in
    --logs-only) LOGS_ONLY=1 ;;
    --no-build) NO_BUILD=1 ;;
    --pull-only) PULL_ONLY=1 ;;
    --full-build) FORCE_BUILD=1 ;;
  esac
done
if [ -n "$SGB_FORCE_BUILD" ] && [ "$SGB_FORCE_BUILD" != "0" ]; then
  FORCE_BUILD=1
fi

export PATH="/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

# Re-run as root when PC passes NAS_SUDO_PASSWORD (Synology SSH sudo needs password)
if [ "$(id -u)" != "0" ] && [ -n "$NAS_SUDO_PASSWORD" ] && [ -z "$SGB_DEPLOY_AS_ROOT" ]; then
  export SGB_DEPLOY_AS_ROOT=1
  printf '%s\n' "$NAS_SUDO_PASSWORD" | sudo -S -E env \
    SGB_BRANCH="${SGB_BRANCH:-}" \
    SGB_REPO_DIR="$REPO_DIR" \
    SGB_DOCKER_SUDO="${SGB_DOCKER_SUDO:-}" \
    SGB_FORCE_BUILD="${SGB_FORCE_BUILD:-}" \
    NAS_SUDO_PASSWORD="$NAS_SUDO_PASSWORD" \
    SGB_DEPLOY_AS_ROOT=1 \
    sh "$0" "$@"
  exit $?
fi

log() {
  echo "$@"
  if [ -n "$LOG_FILE" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG_FILE"
  fi
}

read_deploy_branch() {
  if [ -n "$SGB_BRANCH" ]; then
    echo "$SGB_BRANCH"
    return
  fi
  if [ -f "$REPO_DIR/.env" ]; then
    line=$(grep -E '^SGB_DEPLOY_BRANCH=' "$REPO_DIR/.env" 2>/dev/null | tail -n 1 || true)
    if [ -n "$line" ]; then
      echo "${line#SGB_DEPLOY_BRANCH=}" | tr -d '\r' | tr -d '"' | tr -d "'"
      return
    fi
  fi
  echo "main"
}

read_env_value() {
  key="$1"
  fallback="$2"
  if [ -f "$REPO_DIR/.env" ]; then
    line=$(grep -E "^${key}=" "$REPO_DIR/.env" 2>/dev/null | tail -n 1 || true)
    if [ -n "$line" ]; then
      val=$(echo "${line#*=}" | tr -d '\r' | tr -d '"' | tr -d "'")
      if [ -n "$val" ]; then
        echo "$val"
        return
      fi
    fi
  fi
  echo "$fallback"
}

BRANCH=$(read_deploy_branch)
API_CONTAINER=$(read_env_value SGB_API_CONTAINER saenggibu-api)
GATEWAY_CONTAINER=$(read_env_value SGB_GATEWAY_CONTAINER saenggibu-gateway)
TUNNEL_CONTAINER=$(read_env_value SGB_TUNNEL_CONTAINER saenggibu-tunnel)
LOG_DIR="$REPO_DIR/logs"
LOG_FILE="$LOG_DIR/deploy.log"

resolve_docker() {
  if [ -n "$DOCKER_BIN" ] && [ -x "$DOCKER_BIN" ]; then
    echo "$DOCKER_BIN"
    return
  fi
  for candidate in \
    /usr/local/bin/docker \
    /var/packages/ContainerManager/target/usr/bin/docker \
    /var/packages/ContainerManager/target/bin/docker \
    /var/packages/Docker/target/usr/bin/docker \
    /var/packages/Docker/target/bin/docker
  do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done
  found=$(find /var/packages/ContainerManager /var/packages/Docker \
    -path '*/bin/docker' -type f 2>/dev/null | head -n 1)
  if [ -n "$found" ] && [ -x "$found" ]; then
    echo "$found"
    return
  fi
  if command -v docker >/dev/null 2>&1; then
    command -v docker
    return
  fi
  echo ""
}

resolve_git() {
  for candidate in \
    /usr/bin/git \
    /usr/local/bin/git \
    /var/packages/Git/target/usr/bin/git \
    /var/packages/Git/target/bin/git
  do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done
  if command -v git >/dev/null 2>&1; then
    command -v git
    return
  fi
  echo ""
}

git_sync_deploy() {
  GIT=$(resolve_git)
  if [ -n "$GIT" ]; then
    log "==> git sync ($BRANCH) via $GIT"
    "$GIT" fetch origin "$BRANCH" || "$GIT" fetch origin
    "$GIT" reset --hard "origin/$BRANCH"
    "$GIT" clean -fd -e .env -e '.env.*' -e logs -e data/
    log "==> git at $("$GIT" rev-parse --short HEAD)"
    return
  fi

  log "==> git sync ($BRANCH) via docker (no native git on NAS)"
  ensure_docker_access
  short=$($DOCKER run --rm \
    --entrypoint sh \
    -v "$REPO_DIR:/git" \
    -w /git \
    "$GIT_IMAGE" \
    -ec "
      git config --global --add safe.directory /git
      git fetch origin '$BRANCH'
      git reset --hard 'origin/$BRANCH'
      git clean -fd -e .env -e '.env.*' -e logs -e data/
      git rev-parse --short HEAD
    ")
  log "==> git at $short"
}

git_in_repo() {
  GIT=$(resolve_git)
  if [ -n "$GIT" ]; then
    "$GIT" -C "$REPO_DIR" "$@"
    return $?
  fi
  $DOCKER run --rm \
    --entrypoint git \
    -v "$REPO_DIR:/git" \
    -w /git \
    "$GIT_IMAGE" \
    -C /git "$@"
}

git_current_rev() {
  git_in_repo rev-parse HEAD 2>/dev/null || true
}

git_diff_name_only() {
  old_rev="$1"
  new_rev="$2"
  git_in_repo diff --name-only "$old_rev" "$new_rev" 2>/dev/null || true
}

classify_deploy_changes() {
  old_rev="$1"
  new_rev="$2"
  if [ -z "$old_rev" ]; then
    echo "rebuild"
    return
  fi
  if [ "$old_rev" = "$new_rev" ]; then
    echo "none"
    return
  fi

  files=$(git_diff_name_only "$old_rev" "$new_rev")
  if [ -z "$files" ]; then
    echo "rebuild"
    return
  fi

  need_rebuild=0
  need_restart=0
  ui_only=1

  while IFS= read -r file; do
    [ -n "$file" ] || continue
    case "$file" in
      Dockerfile|requirements.txt|server.py)
        need_rebuild=1
        ui_only=0
        ;;
      docker-compose*.yml|docker/*)
        need_rebuild=1
        ui_only=0
        ;;
      src/*|prompts/*)
        need_rebuild=1
        ui_only=0
        ;;
      web/admin/*)
        ;;
      *)
        ui_only=0
        ;;
    esac
  done <<EOF
$files
EOF

  if [ "$need_rebuild" = "1" ]; then
    echo "rebuild"
    return
  fi
  if [ "$need_restart" = "1" ]; then
    echo "restart"
    return
  fi
  if [ "$ui_only" = "1" ]; then
    echo "ui-only"
    return
  fi
  echo "restart"
}

compose_files() {
  files="-f docker-compose.yml"
  if [ -f docker-compose.cloudflare.yml ] && grep -q '^CLOUDFLARE_TUNNEL_TOKEN=' .env 2>/dev/null; then
    files="$files -f docker-compose.cloudflare.yml"
  fi
  printf '%s' "$files"
}

compose_app_services() {
  files=$(compose_files)
  services="sgb-api"
  # shellcheck disable=SC2086
  if $DOCKER compose $files config --services 2>/dev/null | grep -qx 'sgb-gateway'; then
    services="$services sgb-gateway"
  fi
  printf '%s' "$services"
}

compose_service_names() {
  files=$(compose_files)
  # shellcheck disable=SC2086
  $DOCKER compose $files config --services 2>/dev/null || true
}

service_in_compose() {
  name="$1"
  echo "$(compose_service_names)" | grep -qx "$name"
}

prune_stale_stack_containers() {
  for pair in "$API_CONTAINER:sgb-api" "$GATEWAY_CONTAINER:sgb-gateway" "$TUNNEL_CONTAINER:cloudflared"; do
    cname="${pair%%:*}"
    svc="${pair#*:}"
    if $DOCKER container inspect "$cname" >/dev/null 2>&1; then
      if ! service_in_compose "$svc"; then
        log "==> remove stale $cname (not in current compose stack)"
        $DOCKER rm -f "$cname" 2>/dev/null || true
      fi
    fi
  done
}

prepare_compose_rebuild() {
  prune_stale_stack_containers
  for name in "$API_CONTAINER" "$GATEWAY_CONTAINER"; do
    if $DOCKER container inspect "$name" >/dev/null 2>&1; then
      log "==> stop $name before rebuild (free port / layout change)"
      $DOCKER rm -f "$name" 2>/dev/null || true
    fi
  done
}

remove_stopped_container() {
  name="$1"
  if $DOCKER container inspect "$name" >/dev/null 2>&1; then
    running=$($DOCKER inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo false)
    if [ "$running" != "true" ]; then
      log "==> remove stopped $name"
      $DOCKER rm -f "$name" 2>/dev/null || true
    fi
  fi
}

compose_up() {
  mode="${1:-rebuild}"
  files=$(compose_files)
  services=$(compose_app_services)

  remove_stopped_container "$API_CONTAINER"
  remove_stopped_container "$GATEWAY_CONTAINER"
  remove_stopped_container "$TUNNEL_CONTAINER"

  # shellcheck disable=SC2086
  case "$mode" in
    restart)
      log "==> docker compose restart $services (tunnel untouched)"
      $DOCKER compose $files restart $services
      ;;
    rebuild)
      prepare_compose_rebuild
      log "==> docker compose up -d --build --remove-orphans $services (tunnel untouched)"
      $DOCKER compose $files up -d --build --remove-orphans $services
      ;;
    up)
      prune_stale_stack_containers
      log "==> docker compose up -d --remove-orphans $services (tunnel untouched)"
      $DOCKER compose $files up -d --remove-orphans $services
      ;;
    *)
      log "ERROR: unknown compose mode: $mode"
      exit 1
      ;;
  esac

  ensure_cloudflared_running
}

uses_cloudflare_tunnel() {
  [ -f .env ] && grep -q '^CLOUDFLARE_TUNNEL_TOKEN=' .env 2>/dev/null
}

container_running() {
  name="$1"
  [ "$($DOCKER inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo false)" = "true" ]
}

ensure_cloudflared_running() {
  files=$(compose_files)
  if ! uses_cloudflare_tunnel; then
    return
  fi
  if ! echo "$files" | grep -q cloudflare; then
    return
  fi
  if container_running "$TUNNEL_CONTAINER"; then
    return
  fi
  log "==> start cloudflared (missing or stopped)"
  # shellcheck disable=SC2086
  $DOCKER compose $files up -d cloudflared
}

ensure_compose_stack() {
  if ! uses_cloudflare_tunnel; then
    return
  fi
  need_build=0
  if service_in_compose sgb-gateway && ! container_running "$GATEWAY_CONTAINER"; then
    log "WARN: $GATEWAY_CONTAINER not running — will create stack"
    need_build=1
  fi
  if service_in_compose sgb-api && ! container_running "$API_CONTAINER"; then
    log "WARN: $API_CONTAINER not running — will create stack"
    need_build=1
  fi
  if [ "$need_build" = "1" ]; then
    compose_up rebuild
  else
    compose_up up
  fi
}

enable_maintenance_page() {
  mkdir -p "$REPO_DIR/data/saenggibu"
  touch "$REPO_DIR/data/saenggibu/maintenance.on"
  MAINTENANCE_ENABLED=1
  log "==> maintenance page ON"
}

disable_maintenance_page() {
  rm -f "$REPO_DIR/data/saenggibu/maintenance.on"
  MAINTENANCE_ENABLED=0
  log "==> maintenance page OFF"
}

cleanup_deploy_exit() {
  code=$?
  if [ "$code" -ne 0 ] && [ "${MAINTENANCE_ENABLED:-0}" = "1" ]; then
    log "WARN: deploy failed (exit $code) — removing maintenance flag"
    rm -f "$REPO_DIR/data/saenggibu/maintenance.on" 2>/dev/null || true
    MAINTENANCE_ENABLED=0
  fi
  exit "$code"
}

docker_can_run() {
  # shellcheck disable=SC2086
  $DOCKER info >/dev/null 2>&1
}

ensure_docker_access() {
  if docker_can_run; then
    return
  fi

  base=$DOCKER
  for prefix in "sudo -n" "sudo"; do
    DOCKER="$prefix $base"
    if docker_can_run; then
      log "==> docker ($prefix): $DOCKER"
      return
    fi
  done

  log "ERROR: cannot access docker daemon."
  log "  1) One-time (root): sh scripts/nas-setup-docker-sudo.sh"
  log "  2) Pass NAS_SUDO_PASSWORD env (password: ohola-nas .env.local on PC)"
  log "  3) NAS .env: SGB_DOCKER_SUDO=1"
  log "  4) DSM Task Scheduler as root"
  exit 126
}

read_env_flag() {
  key="$1"
  if [ -f "$REPO_DIR/.env" ]; then
    line=$(grep -E "^${key}=" "$REPO_DIR/.env" 2>/dev/null | tail -n 1 || true)
    if [ -n "$line" ]; then
      val=$(echo "${line#*=}" | tr -d '\r' | tr -d '"' | tr -d "'")
      if [ "$val" = "1" ] || [ "$val" = "true" ] || [ "$val" = "yes" ]; then
        echo "1"
        return
      fi
    fi
  fi
  echo ""
}

if [ -z "$SGB_DOCKER_SUDO" ]; then
  SGB_DOCKER_SUDO=$(read_env_flag SGB_DOCKER_SUDO)
fi
# default: try sudo for Synology non-root SSH users
if [ -z "$SGB_DOCKER_SUDO" ]; then
  SGB_DOCKER_SUDO=1
fi

DOCKER=$(resolve_docker)
if [ -z "$DOCKER" ]; then
  log "ERROR: docker not found."
  log "Open DSM Container Manager and ensure it is running."
  exit 127
fi

mkdir -p "$LOG_DIR"
MAINTENANCE_ENABLED=0
trap cleanup_deploy_exit EXIT
log "==> deploy start (branch=$BRANCH)"

cd "$REPO_DIR" || exit 1

if [ "$LOGS_ONLY" = "1" ]; then
  ensure_docker_access
  log "==> docker: $DOCKER"
  $DOCKER compose logs -f --tail=80
  exit 0
fi

if [ ! -d .git ]; then
  log "ERROR: no .git in $REPO_DIR"
  exit 1
fi

OLD_REV=$(git_current_rev)
git_sync_deploy

# PC deploy curls to /tmp/sgb-deploy.sh; after git sync, run repo copy so
# --full-build and deploy-scope logic always match the commit we just pulled.
REPO_SCRIPT="$REPO_DIR/scripts/nas-docker-update.sh"
case "$0" in
  "$REPO_SCRIPT"|*/scripts/nas-docker-update.sh) ;;
  *)
    if [ -f "$REPO_SCRIPT" ]; then
      log "==> re-exec deploy script from repo (post git sync)"
      exec sh "$REPO_SCRIPT" "$@"
    fi
    ;;
esac

NEW_REV=$(git_current_rev)
DEPLOY_SCOPE=$(classify_deploy_changes "$OLD_REV" "$NEW_REV")
log "==> deploy scope: $DEPLOY_SCOPE"

if [ "$PULL_ONLY" = "1" ]; then
  log "==> pull only (--pull-only)"
elif [ "$NO_BUILD" = "1" ]; then
  log "==> skip docker build (--no-build)"
elif [ "$FORCE_BUILD" = "1" ]; then
  ensure_docker_access
  log "==> docker: $DOCKER"
  log "==> forced API rebuild (--full-build)"
  enable_maintenance_page
  compose_up rebuild
elif [ "$DEPLOY_SCOPE" = "none" ]; then
  log "==> no file changes — skip docker build"
elif [ "$DEPLOY_SCOPE" = "ui-only" ]; then
  log "==> UI only — skip docker build (Ctrl+F5 in browser)"
else
  ensure_docker_access
  log "==> docker: $DOCKER"
  enable_maintenance_page
  if [ "$DEPLOY_SCOPE" = "restart" ]; then
    compose_up restart
  else
    compose_up rebuild
  fi
fi

if [ "$PULL_ONLY" != "1" ] && uses_cloudflare_tunnel; then
  ensure_docker_access
  ensure_compose_stack
fi

wait_for_health() {
  i=0
  while [ "$i" -lt 30 ]; do
    if curl -sf "http://127.0.0.1:${SGB_PORT:-8787}/health" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  return 1
}

if command -v curl >/dev/null 2>&1; then
  if wait_for_health; then
    log "==> health OK"
    disable_maintenance_page
  else
    log "WARN: health check failed — try: docker logs $API_CONTAINER --tail 50"
    log "WARN: gateway: docker logs $GATEWAY_CONTAINER --tail 30"
    log "WARN: tunnel target must be http://sgb-gateway:8787 after gateway deploy"
    log "WARN: emergency rollback: tunnel -> http://sgb-api:8787 if gateway missing"
    log "WARN: stuck maintenance? rm data/saenggibu/maintenance.on"
  fi
else
  disable_maintenance_page
fi

log "==> done ($(date '+%Y-%m-%d %H:%M'))"
