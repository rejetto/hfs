FROM debian:bookworm-slim

ARG HFS_VERSION
ARG TARGETARCH

WORKDIR /opt/hfs

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    version="${HFS_VERSION#v}"; \
    case "$TARGETARCH" in \
        amd64) arch="x64" ;; \
        arm64) arch="arm64" ;; \
        *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    url="https://github.com/rejetto/hfs/releases/download/v${version}/hfs-linux-${arch}-${version}.zip"; \
    curl -fsSL "$url" -o hfs.zip; \
    unzip hfs.zip; \
    rm hfs.zip

RUN cat <<'EOF' > /opt/hfs/docker-entrypoint.sh \
    && chmod +x /opt/hfs/docker-entrypoint.sh
#!/bin/sh
set -e
export DISABLE_UPDATE=1

# an empty legacy env would override the initial password when HFS loads the config
if [ -n "${HFS_INITIAL_ADMIN_PASSWORD:-}" ] && [ -z "${HFS_CREATE_ADMIN:-}" ]; then
  unset HFS_CREATE_ADMIN
fi

bootstrap_config() {
  cwd="$1"
  config="$cwd/config.yaml"
  [ -f "$config" ] && return

  mkdir -p "$cwd"
  {
    admin_pw="${HFS_CREATE_ADMIN:-${HFS_INITIAL_ADMIN_PASSWORD:-please-change}}"
    # escape line breaks before shell substitution can strip them from the password
    esc="$(printf '%s' "$admin_pw" | sed -z 's/\\/\\\\/g; s/"/\\"/g; s/\r/\\r/g; s/\n/\\n/g; s/\t/\\t/g')"
    printf 'create-admin: "%s"\n' "$esc"
    printf "vfs:\\n  source: /shares\\n"
  } > "$config"
}

if [ -n "${HFS_CWD:-}" ]; then
  bootstrap_config "$HFS_CWD"
  exec /opt/hfs/hfs --cwd "$HFS_CWD" "$@"
fi

# Legacy compatibility: keep older images working (config mounted at /home/hfs/.hfs).
if [ -d /home/hfs/.hfs ] || [ -f /home/hfs/.hfs/config.yaml ]; then
  bootstrap_config /home/hfs/.hfs
  exec /opt/hfs/hfs --cwd /home/hfs/.hfs "$@"
fi

bootstrap_config /data
exec /opt/hfs/hfs --cwd /data "$@"
EOF

EXPOSE 80
VOLUME ["/data"]

ENTRYPOINT ["/opt/hfs/docker-entrypoint.sh"]
