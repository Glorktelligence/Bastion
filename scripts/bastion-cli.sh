#!/bin/bash
# bastion — Bastion CLI management tool
# Copyright 2026 Glorktelligence — Harry Smith
# Licensed under the Apache License, Version 2.0
#
# Single user architecture: ALL components run as 'bastion' user.
# VM-level isolation provides security separation (relay VLAN 30, AI VLAN 50).
# User-level isolation within VMs is redundant and causes permission hell.
#
# Usage:
#   bastion version                          Show installed version
#   bastion status [component]               Show systemd service status
#   bastion doctor                           Health check (prerequisites, services, network)
#   bastion install --vm relay|ai            Fresh install (run as root)
#   bastion install --fresh --vm relay|ai    Reset build artifacts (preserves data)
#   bastion install --fresh --data --vm relay|ai  Reset everything including data
#   bastion update --component relay|ai      Pull, install, build
#   bastion restart --component relay|ai|admin|all
#   bastion start --component relay|ai|admin|all
#   bastion stop --component relay|ai|admin|all
#   bastion audit <component> [--live|--full] View service logs
#   bastion migrate --vm relay|ai            One-time migration (run as root)
#   bastion help                             Show this help

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration — Single User Architecture
# ---------------------------------------------------------------------------

BASTION_USER="bastion"
BASTION_GROUP="bastion"
BASTION_ROOT="${BASTION_ROOT:-/opt/bastion}"
BASTION_DATA="${BASTION_DATA:-/var/lib/bastion}"
BASTION_REPO="https://github.com/Glorktelligence/Bastion.git"
VERSION_FILE="VERSION"

# Service names (systemd) — same on ALL VMs
SVC_RELAY="bastion-relay"
SVC_ADMIN="bastion-admin-ui"
SVC_AI="bastion-ai-client"

# Colours
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log_info()    { echo -e "${BLUE}[✓]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
log_error()   { echo -e "${RED}[✗]${NC} $*"; }
log_step()    { echo -e "${GREEN}[→]${NC} $*"; }
log_header()  { echo -e "\n${BOLD}${CYAN}=== $* ===${NC}\n"; }

get_version() {
    local root="${1:-$BASTION_ROOT}"
    if [[ -f "$root/$VERSION_FILE" ]]; then
        cat "$root/$VERSION_FILE"
    else
        echo "unknown"
    fi
}

require_root() {
    if [[ "$(id -u)" -ne 0 ]]; then
        log_error "This command must run as root"
        log_info "Try: sudo bastion $*"
        exit 1
    fi
}

require_bastion_user() {
    local current
    current=$(whoami)
    if [[ "$current" != "$BASTION_USER" ]]; then
        log_error "This command must run as '$BASTION_USER' (currently: '$current')"
        log_info "Try: sudo -u $BASTION_USER bastion $*"
        exit 1
    fi
}

check_svc() {
    local name="$1" svc="$2"
    local status
    status=$(systemctl is-active "$svc" 2>/dev/null || echo "not found")
    if [[ "$status" == "active" ]]; then
        echo -e "  $name: ${GREEN}active${NC}"
    elif [[ "$status" == "inactive" ]]; then
        echo -e "  $name: ${YELLOW}inactive${NC}"
    else
        echo -e "  $name: ${RED}$status${NC}"
    fi
}

# ---------------------------------------------------------------------------
# Migration — One-time transition to single-user architecture
# ---------------------------------------------------------------------------

cmd_migrate() {
    local vm_type="${1:-}"
    if [[ -z "$vm_type" ]]; then
        log_error "Missing --vm flag. Usage: bastion migrate --vm relay|ai"
        exit 1
    fi

    require_root

    log_header "Project Bastion — Migration to Single User Architecture"
    echo "  VM type:     $vm_type"
    echo "  Target user: $BASTION_USER"
    echo "  Target group: $BASTION_GROUP"
    echo ""

    case "$vm_type" in
        relay) migrate_relay ;;
        ai)    migrate_ai ;;
        *)     log_error "Unknown VM type: $vm_type (use: relay or ai)"; exit 1 ;;
    esac
}

migrate_relay() {
    log_header "Migrating Relay VM to single bastion user"

    # Step 1: Stop all services
    log_step "Stopping all Bastion services..."
    systemctl stop "$SVC_RELAY" 2>/dev/null || true
    systemctl stop "$SVC_ADMIN" 2>/dev/null || true
    systemctl stop "bastion-updater" 2>/dev/null || true
    log_info "Services stopped"

    # Step 2: Ensure bastion user exists
    if id "$BASTION_USER" &>/dev/null; then
        log_info "User '$BASTION_USER' already exists"
    else
        log_step "Creating user '$BASTION_USER'..."
        useradd --system --create-home --shell /bin/bash "$BASTION_USER"
        log_info "User created"
    fi

    # Step 3: Fix /opt/bastion ownership
    if [[ -d "$BASTION_ROOT" ]]; then
        log_step "Setting ownership: $BASTION_ROOT → $BASTION_USER:$BASTION_GROUP"
        chown -R "$BASTION_USER:$BASTION_GROUP" "$BASTION_ROOT"
        log_info "Repository ownership fixed"
    fi

    # Step 4: Fix /var/lib/bastion ownership
    if [[ -d "$BASTION_DATA" ]]; then
        log_step "Setting ownership: $BASTION_DATA → $BASTION_USER:$BASTION_GROUP"
        chown -R "$BASTION_USER:$BASTION_GROUP" "$BASTION_DATA"
        log_info "Data directory ownership fixed"
    else
        log_step "Creating $BASTION_DATA..."
        mkdir -p "$BASTION_DATA"
        chown -R "$BASTION_USER:$BASTION_GROUP" "$BASTION_DATA"
        log_info "Data directory created"
    fi

    # Step 5: Fix cache directories (the corepack permission hell)
    local bastion_home
    bastion_home=$(eval echo "~$BASTION_USER")
    log_step "Fixing cache ownership: $bastion_home/.cache/"
    mkdir -p "$bastion_home/.cache"
    chown -R "$BASTION_USER:$BASTION_GROUP" "$bastion_home/.cache"
    # Also fix npm/pnpm global dirs if they exist
    [[ -d "$bastion_home/.npm-global" ]] && chown -R "$BASTION_USER:$BASTION_GROUP" "$bastion_home/.npm-global"
    [[ -d "$bastion_home/.local" ]] && chown -R "$BASTION_USER:$BASTION_GROUP" "$bastion_home/.local"
    log_info "Cache ownership fixed (goodbye corepack permission errors)"

    # Step 6: Remove bastion-updater user (no longer needed)
    if id "bastion-updater" &>/dev/null; then
        log_step "Removing bastion-updater user..."
        systemctl disable "bastion-updater" 2>/dev/null || true
        userdel "bastion-updater" 2>/dev/null || true
        log_info "bastion-updater user removed"
    else
        log_info "No bastion-updater user found (already clean)"
    fi

    # Step 7: Remove old updater repo if exists
    if [[ -d "/opt/bastion-updater" ]]; then
        log_step "Removing /opt/bastion-updater (no longer needed)..."
        rm -rf "/opt/bastion-updater"
        log_info "Updater directory removed"
    fi

    # Step 8: Install systemd service templates
    install_systemd_relay

    # Step 9: Install CLI to /usr/local/bin
    install_cli

    # Step 10: Verify
    verify_migration "relay"

    log_header "Relay VM migration COMPLETE"
    echo "  Next steps:"
    echo "    bastion status"
    echo "    sudo -u bastion bastion update --component relay"
    echo ""
}

migrate_ai() {
    log_header "Migrating AI VM to single bastion user"

    # Step 1: Stop all services
    log_step "Stopping all Bastion services..."
    systemctl stop "$SVC_AI" 2>/dev/null || true
    systemctl stop "bastion-updater-ai" 2>/dev/null || true
    systemctl stop "bastion-updater" 2>/dev/null || true
    log_info "Services stopped"

    # Step 2: Handle user migration (bastion-ai → bastion)
    if id "bastion-ai" &>/dev/null && ! id "$BASTION_USER" &>/dev/null; then
        log_step "Renaming user: bastion-ai → $BASTION_USER"
        usermod -l "$BASTION_USER" "bastion-ai"
        groupmod -n "$BASTION_GROUP" "bastion-ai" 2>/dev/null || true
        usermod -d "/home/$BASTION_USER" -m "$BASTION_USER" 2>/dev/null || true
        log_info "User renamed: bastion-ai → $BASTION_USER"
    elif id "$BASTION_USER" &>/dev/null; then
        log_info "User '$BASTION_USER' already exists"
    else
        log_step "Creating user '$BASTION_USER'..."
        useradd --system --create-home --shell /bin/bash "$BASTION_USER"
        log_info "User created"
    fi

    # Step 3: Migrate /opt/bastion-ai → /opt/bastion (if old path exists)
    if [[ -d "/opt/bastion-ai" && ! -d "$BASTION_ROOT" ]]; then
        log_step "Moving /opt/bastion-ai → $BASTION_ROOT"
        mv "/opt/bastion-ai" "$BASTION_ROOT"
        log_info "Repository moved"
    elif [[ -d "/opt/bastion-ai" && -d "$BASTION_ROOT" ]]; then
        log_warn "/opt/bastion-ai AND $BASTION_ROOT both exist — keeping $BASTION_ROOT"
        log_warn "Remove /opt/bastion-ai manually after verifying data"
    fi

    # Step 4: Migrate /var/lib/bastion-ai → /var/lib/bastion (if old path exists)
    if [[ -d "/var/lib/bastion-ai" && ! -d "$BASTION_DATA" ]]; then
        # Check if it's a mount point (separate disk) — can't mv, must remount
        if mountpoint -q "/var/lib/bastion-ai" 2>/dev/null; then
            log_step "Detected /var/lib/bastion-ai is a mount point (separate disk)"
            log_step "Updating fstab: /var/lib/bastion-ai → $BASTION_DATA"
            sed -i "s|/var/lib/bastion-ai|$BASTION_DATA|g" /etc/fstab
            mkdir -p "$BASTION_DATA"
            umount /var/lib/bastion-ai
            mount "$BASTION_DATA"
            rmdir /var/lib/bastion-ai 2>/dev/null || true
            log_info "Disk remounted at $BASTION_DATA (data preserved, zero copy)"
        else
            log_step "Moving /var/lib/bastion-ai → $BASTION_DATA"
            mv "/var/lib/bastion-ai" "$BASTION_DATA"
            log_info "Data directory moved"
        fi
    elif [[ -d "/var/lib/bastion-ai" && -d "$BASTION_DATA" ]]; then
        log_warn "/var/lib/bastion-ai AND $BASTION_DATA both exist"
        log_warn "Merging: copying new files from old → new..."
        cp -rn "/var/lib/bastion-ai/"* "$BASTION_DATA/" 2>/dev/null || true
        log_info "Data merged (old dir preserved for manual review)"
    else
        log_step "Creating $BASTION_DATA..."
        mkdir -p "$BASTION_DATA"
    fi

    # Step 5: Fix ownership on everything
    log_step "Setting ownership: $BASTION_ROOT → $BASTION_USER:$BASTION_GROUP"
    chown -R "$BASTION_USER:$BASTION_GROUP" "$BASTION_ROOT"
    log_step "Setting ownership: $BASTION_DATA → $BASTION_USER:$BASTION_GROUP"
    chown -R "$BASTION_USER:$BASTION_GROUP" "$BASTION_DATA"

    # Fix cache directories
    local bastion_home
    bastion_home=$(eval echo "~$BASTION_USER")
    mkdir -p "$bastion_home/.cache"
    chown -R "$BASTION_USER:$BASTION_GROUP" "$bastion_home/.cache"
    [[ -d "$bastion_home/.npm-global" ]] && chown -R "$BASTION_USER:$BASTION_GROUP" "$bastion_home/.npm-global"
    [[ -d "$bastion_home/.local" ]] && chown -R "$BASTION_USER:$BASTION_GROUP" "$bastion_home/.local"
    log_info "All ownership fixed"

    # Step 6: Update .env file paths (bastion-ai → bastion)
    local env_file="$BASTION_ROOT/.env"
    if [[ -f "$env_file" ]]; then
        log_step "Updating .env paths: bastion-ai → bastion"
        sed -i 's|/var/lib/bastion-ai/|/var/lib/bastion/|g' "$env_file"
        sed -i 's|/opt/bastion-ai/|/opt/bastion/|g' "$env_file"
        sed -i 's|/home/bastion-ai/|/home/bastion/|g' "$env_file"
        log_info ".env paths updated"
    fi

    # Step 7: Update start-ai-client.mjs hardcoded paths
    local start_file="$BASTION_ROOT/start-ai-client.mjs"
    if [[ -f "$start_file" ]]; then
        if grep -q "bastion-ai" "$start_file"; then
            log_step "Updating start-ai-client.mjs paths: bastion-ai → bastion"
            sed -i 's|/var/lib/bastion-ai/|/var/lib/bastion/|g' "$start_file"
            log_info "Start script paths updated"
        else
            log_info "Start script already uses /var/lib/bastion/ paths"
        fi
    fi

    # Step 8: Remove old users
    if id "bastion-ai" &>/dev/null; then
        log_step "Removing old bastion-ai user (already renamed)..."
        userdel "bastion-ai" 2>/dev/null || log_info "(user was renamed, not deleted)"
    fi
    if id "bastion-updater" &>/dev/null; then
        log_step "Removing bastion-updater user..."
        systemctl disable "bastion-updater" 2>/dev/null || true
        systemctl disable "bastion-updater-ai" 2>/dev/null || true
        userdel "bastion-updater" 2>/dev/null || true
        log_info "bastion-updater user removed"
    fi

    # Step 9: Remove old updater repo
    if [[ -d "/opt/bastion-updater" ]]; then
        log_step "Removing /opt/bastion-updater..."
        rm -rf "/opt/bastion-updater"
        log_info "Updater directory removed"
    fi

    # Step 10: Install systemd service templates
    install_systemd_ai

    # Step 11: Install CLI
    install_cli

    # Step 12: Verify
    verify_migration "ai"

    log_header "AI VM migration COMPLETE"
    echo "  Next steps:"
    echo "    bastion status"
    echo "    sudo -u bastion bastion update --component ai"
    echo ""
}

# ---------------------------------------------------------------------------
# Systemd Service Template Installers
# ---------------------------------------------------------------------------

install_systemd_relay() {
    log_step "Installing systemd services for relay VM..."

    # Relay service
    cat > /etc/systemd/system/bastion-relay.service << 'SYSTEMD_EOF'
[Unit]
Description=Bastion Relay Server
After=network.target

[Service]
Type=simple
User=bastion
Group=bastion
WorkingDirectory=/opt/bastion
ExecStart=/usr/bin/node /opt/bastion/start-relay.mjs
Restart=always
RestartSec=5
RestartPreventExitStatus=99
EnvironmentFile=-/opt/bastion/.env
Environment=NODE_ENV=production

# Security hardening
NoNewPrivileges=true
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
SYSTEMD_EOF

    # Admin UI service
    cat > /etc/systemd/system/bastion-admin-ui.service << 'SYSTEMD_EOF'
[Unit]
Description=Bastion Admin UI
After=bastion-relay.service
Requires=bastion-relay.service

[Service]
Type=simple
User=bastion
Group=bastion
WorkingDirectory=/opt/bastion/packages/relay-admin-ui
ExecStart=/usr/bin/node /opt/bastion/packages/relay-admin-ui/build/index.js
Restart=always
RestartSec=5
RestartPreventExitStatus=99
EnvironmentFile=-/opt/bastion/.env
Environment=NODE_ENV=production
Environment=PORT=9445
Environment=HOST=127.0.0.1
Environment=ORIGIN=http://127.0.0.1:9445

# Security hardening
NoNewPrivileges=true
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
SYSTEMD_EOF

    # Disable old updater service if it exists
    systemctl disable bastion-updater 2>/dev/null || true
    rm -f /etc/systemd/system/bastion-updater.service 2>/dev/null || true

    systemctl daemon-reload
    systemctl enable bastion-relay bastion-admin-ui
    log_info "Relay systemd services installed and enabled"
}

install_systemd_ai() {
    log_step "Installing systemd services for AI VM..."

    # AI Client service
    cat > /etc/systemd/system/bastion-ai-client.service << 'SYSTEMD_EOF'
[Unit]
Description=Bastion AI Client
After=network.target

[Service]
Type=simple
User=bastion
Group=bastion
WorkingDirectory=/opt/bastion
ExecStart=/usr/bin/node --env-file=.env /opt/bastion/start-ai-client.mjs
Restart=always
RestartSec=5
RestartPreventExitStatus=99
EnvironmentFile=-/opt/bastion/.env
Environment=NODE_ENV=production

# Security hardening
NoNewPrivileges=true
ProtectHome=true
PrivateTmp=true

# Data directory access
ReadWritePaths=/var/lib/bastion

[Install]
WantedBy=multi-user.target
SYSTEMD_EOF

    # Disable old updater services if they exist
    systemctl disable bastion-updater 2>/dev/null || true
    systemctl disable bastion-updater-ai 2>/dev/null || true
    rm -f /etc/systemd/system/bastion-updater.service 2>/dev/null || true
    rm -f /etc/systemd/system/bastion-updater-ai.service 2>/dev/null || true

    systemctl daemon-reload
    systemctl enable bastion-ai-client
    log_info "AI Client systemd service installed and enabled"
}

# ---------------------------------------------------------------------------
# CLI + Verification Helpers
# ---------------------------------------------------------------------------

install_cli() {
    log_step "Installing CLI to /usr/local/bin/bastion..."
    local src="$BASTION_ROOT/scripts/bastion-cli.sh"
    if [[ -f "$src" ]]; then
        cp "$src" /usr/local/bin/bastion
        chmod +x /usr/local/bin/bastion
        log_info "CLI installed: /usr/local/bin/bastion"
    else
        log_warn "CLI source not found at $src — install manually"
    fi
}

verify_migration() {
    local vm_type="$1"
    log_header "Verification"

    # Check user exists
    if id "$BASTION_USER" &>/dev/null; then
        log_info "User '$BASTION_USER' exists ✓"
    else
        log_error "User '$BASTION_USER' NOT FOUND ✗"
    fi

    # Check old users are gone
    for old_user in "bastion-ai" "bastion-updater"; do
        if id "$old_user" &>/dev/null; then
            log_warn "Old user '$old_user' still exists"
        else
            log_info "Old user '$old_user' removed ✓"
        fi
    done

    # Check directory ownership
    if [[ -d "$BASTION_ROOT" ]]; then
        local owner
        owner=$(stat -c '%U' "$BASTION_ROOT")
        if [[ "$owner" == "$BASTION_USER" ]]; then
            log_info "$BASTION_ROOT owned by $BASTION_USER ✓"
        else
            log_error "$BASTION_ROOT owned by $owner (expected $BASTION_USER) ✗"
        fi
    fi

    if [[ -d "$BASTION_DATA" ]]; then
        local owner
        owner=$(stat -c '%U' "$BASTION_DATA")
        if [[ "$owner" == "$BASTION_USER" ]]; then
            log_info "$BASTION_DATA owned by $BASTION_USER ✓"
        else
            log_error "$BASTION_DATA owned by $owner (expected $BASTION_USER) ✗"
        fi
    fi

    # Check systemd services are installed
    if [[ "$vm_type" == "relay" ]]; then
        systemctl is-enabled "$SVC_RELAY" &>/dev/null && log_info "$SVC_RELAY enabled ✓" || log_error "$SVC_RELAY not enabled ✗"
        systemctl is-enabled "$SVC_ADMIN" &>/dev/null && log_info "$SVC_ADMIN enabled ✓" || log_error "$SVC_ADMIN not enabled ✗"
    elif [[ "$vm_type" == "ai" ]]; then
        systemctl is-enabled "$SVC_AI" &>/dev/null && log_info "$SVC_AI enabled ✓" || log_error "$SVC_AI not enabled ✗"
    fi

    # Check no old updater services
    systemctl is-enabled "bastion-updater" &>/dev/null && log_warn "Old bastion-updater still enabled" || log_info "bastion-updater disabled ✓"

    # Check CLI installed
    if [[ -x /usr/local/bin/bastion ]]; then
        log_info "CLI installed at /usr/local/bin/bastion ✓"
    else
        log_warn "CLI not found at /usr/local/bin/bastion"
    fi
}

# ---------------------------------------------------------------------------
# Operational Commands
# ---------------------------------------------------------------------------

cmd_version() {
    echo "=== Project Bastion — Version ==="
    echo ""
    echo "  Version: $(get_version)"
    echo "  Path:    $BASTION_ROOT"
    echo "  User:    $BASTION_USER"
    echo ""
}

cmd_status() {
    local component="${1:-all}"
    echo "=== Project Bastion — Status ==="
    echo ""

if [[ "$component" == "all" || "$component" == "relay" ]]; then
        check_svc "Relay    " "$SVC_RELAY"
    fi
    if [[ "$component" == "all" || "$component" == "admin" ]]; then
        check_svc "Admin UI " "$SVC_ADMIN"
    fi
    if [[ "$component" == "all" || "$component" == "ai" ]]; then
        check_svc "AI Client" "$SVC_AI"
    fi
    echo ""
}

cmd_update() {
    local component="${1:-}"
    if [[ -z "$component" ]]; then
        log_error "Missing --component flag. Usage: bastion update --component relay|ai"
        exit 1
    fi

    require_bastion_user

    log_header "Updating Bastion ($component)"

    cd "$BASTION_ROOT"

    log_step "Pulling latest changes..."
    git pull origin main
    log_info "Repository updated"

    log_step "Installing dependencies..."
    pnpm install --frozen-lockfile
    log_info "Dependencies installed"

    log_step "Building packages..."
    pnpm build
    log_info "Build complete"

    # Build admin UI app (relay only — SvelteKit needs separate vite build)
    if [[ "$component" == "relay" && -d "$BASTION_ROOT/packages/relay-admin-ui" ]]; then
        log_step "Building admin UI..."
        pnpm --filter @bastion/relay-admin-ui run build:app 2>&1 || log_warn "Admin UI build failed (non-fatal)"
        log_info "Admin UI built"
    fi

    # Self-update CLI if installed globally
    if [[ -x /usr/local/bin/bastion && -f "$BASTION_ROOT/scripts/bastion-cli.sh" ]]; then
        if ! diff -q "$BASTION_ROOT/scripts/bastion-cli.sh" /usr/local/bin/bastion &>/dev/null; then
            log_step "CLI update available..."
            if sudo cp "$BASTION_ROOT/scripts/bastion-cli.sh" /usr/local/bin/bastion 2>/dev/null && \
               sudo chmod +x /usr/local/bin/bastion 2>/dev/null; then
                log_info "CLI updated at /usr/local/bin/bastion"
            else
                log_warn "CLI update needs root: sudo cp $BASTION_ROOT/scripts/bastion-cli.sh /usr/local/bin/bastion"
            fi
        fi
    fi

    local current_version
    current_version=$(get_version)
    log_info "Updated to version: $current_version"

    echo ""
    echo "  Restart services to apply:"
    echo "    bastion restart --component $component"
    echo ""
}

cmd_restart() {
    local component="${1:-all}"

    log_header "Restarting Bastion ($component)"

    if [[ "$component" == "all" || "$component" == "relay" ]]; then
        log_step "Restarting $SVC_RELAY..."
        sudo systemctl restart "$SVC_RELAY"
        log_info "$SVC_RELAY restarted"
    fi
    if [[ "$component" == "all" || "$component" == "admin" ]]; then
        log_step "Restarting $SVC_ADMIN..."
        sudo systemctl restart "$SVC_ADMIN"
        log_info "$SVC_ADMIN restarted"
    fi
    if [[ "$component" == "all" || "$component" == "ai" ]]; then
        log_step "Restarting $SVC_AI..."
        sudo systemctl restart "$SVC_AI"
        log_info "$SVC_AI restarted"
    fi

    echo ""
    cmd_status "$component"
}

cmd_start() {
    local component="${1:-all}"

    log_header "Starting Bastion ($component)"

    if [[ "$component" == "all" || "$component" == "relay" ]]; then
        log_step "Starting $SVC_RELAY..."
        sudo systemctl start "$SVC_RELAY"
        log_info "$SVC_RELAY started"
    fi
    if [[ "$component" == "all" || "$component" == "admin" ]]; then
        log_step "Starting $SVC_ADMIN..."
        sudo systemctl start "$SVC_ADMIN"
        log_info "$SVC_ADMIN started"
    fi
    if [[ "$component" == "all" || "$component" == "ai" ]]; then
        log_step "Starting $SVC_AI..."
        sudo systemctl start "$SVC_AI"
        log_info "$SVC_AI started"
    fi

    echo ""
    cmd_status "$component"
}

cmd_stop() {
    local component="${1:-all}"

    log_header "Stopping Bastion ($component)"

    if [[ "$component" == "all" || "$component" == "ai" ]]; then
        log_step "Stopping $SVC_AI..."
        sudo systemctl stop "$SVC_AI"
        log_info "$SVC_AI stopped"
    fi
    if [[ "$component" == "all" || "$component" == "admin" ]]; then
        log_step "Stopping $SVC_ADMIN..."
        sudo systemctl stop "$SVC_ADMIN"
        log_info "$SVC_ADMIN stopped"
    fi
    if [[ "$component" == "all" || "$component" == "relay" ]]; then
        log_step "Stopping $SVC_RELAY..."
        sudo systemctl stop "$SVC_RELAY"
        log_info "$SVC_RELAY stopped"
    fi

    echo ""
    cmd_status "$component"
}

cmd_audit() {
    local component="${1:-}"
    if [[ -z "$component" ]]; then
        log_error "Missing component. Usage: bastion audit <component> [--live|--full]"
        exit 1
    fi

    local mode="${2:-}"
    local svc=""

    case "$component" in
        relay) svc="$SVC_RELAY" ;;
        admin) svc="$SVC_ADMIN" ;;
        ai)    svc="$SVC_AI" ;;
        *)     log_error "Unknown component: $component (use: relay, admin, ai)"; exit 1 ;;
    esac

    case "$mode" in
        --live)
            log_header "Live logs: $svc"
            sudo journalctl -u "$svc" -f
            ;;
        --full)
            log_header "Full logs: $svc"
            sudo journalctl -u "$svc" --no-pager
            ;;
        *)
            log_header "Recent logs: $svc (last 50 lines)"
            sudo journalctl -u "$svc" -n 50 --no-pager
            ;;
    esac
}

# ---------------------------------------------------------------------------
# Doctor — Health Check
# ---------------------------------------------------------------------------

cmd_doctor() {
    local passed=0 failed=0 warnings=0

    doctor_pass() { echo -e "  ${GREEN}[✓]${NC} $*"; ((passed++)); }
    doctor_fail() { echo -e "  ${RED}[✗]${NC} $*"; ((failed++)); }
    doctor_warn() { echo -e "  ${YELLOW}[!]${NC} $*"; ((warnings++)); }

    log_header "Project Bastion — Doctor"

    # --- Prerequisites ---
    echo -e "${BOLD}Prerequisites:${NC}"

    # Node.js
    if command -v node &>/dev/null; then
        local node_ver
        node_ver=$(node --version 2>/dev/null | sed 's/^v//')
        local node_major
        node_major=$(echo "$node_ver" | cut -d. -f1)
        if [[ "$node_major" -ge 20 ]]; then
            doctor_pass "Node.js v${node_ver} (minimum: v20)"
        else
            doctor_fail "Node.js v${node_ver} (minimum: v20 — upgrade required)"
        fi
    else
        doctor_fail "Node.js not found (install: https://nodejs.org)"
    fi

    # pnpm
    if command -v pnpm &>/dev/null; then
        doctor_pass "pnpm $(pnpm --version 2>/dev/null)"
    else
        doctor_fail "pnpm not found (run: corepack enable)"
    fi

    # git
    if command -v git &>/dev/null; then
        doctor_pass "git $(git --version 2>/dev/null | awk '{print $3}')"
    else
        doctor_fail "git not found"
    fi

    # systemd
    if command -v systemctl &>/dev/null; then
        doctor_pass "systemd available"
    else
        doctor_fail "systemd not available"
    fi

    # corepack
    if command -v corepack &>/dev/null; then
        doctor_pass "corepack available"
    else
        doctor_fail "corepack not enabled (run: corepack enable)"
    fi

    # --- User & Permissions ---
    echo ""
    echo -e "${BOLD}User & Permissions:${NC}"

    if id "$BASTION_USER" &>/dev/null; then
        doctor_pass "$BASTION_USER user exists"
    else
        doctor_fail "$BASTION_USER user does not exist"
    fi

    if [[ -d "$BASTION_ROOT" ]]; then
        local repo_owner
        repo_owner=$(stat -c '%U' "$BASTION_ROOT" 2>/dev/null)
        if [[ "$repo_owner" == "$BASTION_USER" ]]; then
            doctor_pass "$BASTION_ROOT owned by $BASTION_USER"
        else
            doctor_fail "$BASTION_ROOT owned by $repo_owner (expected $BASTION_USER)"
        fi
    else
        doctor_fail "$BASTION_ROOT does not exist"
    fi

    if [[ -d "$BASTION_DATA" ]]; then
        local data_owner
        data_owner=$(stat -c '%U' "$BASTION_DATA" 2>/dev/null)
        if [[ "$data_owner" == "$BASTION_USER" ]]; then
            doctor_pass "$BASTION_DATA owned by $BASTION_USER"
        else
            doctor_fail "$BASTION_DATA owned by $data_owner (expected $BASTION_USER)"
        fi
    else
        doctor_fail "$BASTION_DATA does not exist"
    fi

    local bastion_home
    bastion_home=$(eval echo "~$BASTION_USER" 2>/dev/null)
    if [[ -d "$bastion_home/.cache" ]]; then
        local cache_owner
        cache_owner=$(stat -c '%U' "$bastion_home/.cache" 2>/dev/null)
        if [[ "$cache_owner" == "$BASTION_USER" ]]; then
            doctor_pass "$bastion_home/.cache owned by $BASTION_USER"
        else
            doctor_fail "$bastion_home/.cache owned by $cache_owner (expected $BASTION_USER)"
        fi
    else
        doctor_warn "$bastion_home/.cache does not exist"
    fi

    if [[ -x /usr/local/bin/bastion ]]; then
        doctor_pass "/usr/local/bin/bastion installed"
    else
        doctor_fail "/usr/local/bin/bastion not found (CLI not installed globally)"
    fi

    # --- Services ---
    echo ""
    echo -e "${BOLD}Services:${NC}"

    for svc_pair in "bastion-relay:Relay" "bastion-admin-ui:Admin UI" "bastion-ai-client:AI Client"; do
        local svc="${svc_pair%%:*}"
        local label="${svc_pair##*:}"
        local svc_status
        svc_status=$(systemctl is-active "$svc" 2>/dev/null || echo "not found")
        if [[ "$svc_status" == "active" ]]; then
            doctor_pass "$label ($svc): active"
        elif [[ "$svc_status" == "inactive" ]]; then
            doctor_fail "$label ($svc): inactive"
        elif [[ "$svc_status" == "not found" ]]; then
            # Not installed — only warn, may not be relevant to this VM
            doctor_warn "$label ($svc): not installed"
        else
            doctor_fail "$label ($svc): $svc_status"
        fi
    done

    # --- Network ---
    echo ""
    echo -e "${BOLD}Network:${NC}"

    if command -v ss &>/dev/null; then
        # Port 9443 (relay WSS)
        if ss -tlnp 2>/dev/null | grep -q ':9443 '; then
            doctor_pass "Port 9443 (relay WSS): listening"
        else
            doctor_fail "Port 9443 (relay WSS): not listening"
        fi

        # Port 9444 (admin API)
        if ss -tlnp 2>/dev/null | grep -q ':9444 '; then
            local bind_9444
            bind_9444=$(ss -tlnp 2>/dev/null | grep ':9444 ' | awk '{print $4}' | head -1)
            if echo "$bind_9444" | grep -q '127.0.0.1'; then
                doctor_pass "Port 9444 (admin API): listening on 127.0.0.1"
            elif echo "$bind_9444" | grep -q '0.0.0.0\|\*'; then
                doctor_fail "Port 9444 (admin API): WARNING — bound to 0.0.0.0 (should be 127.0.0.1!)"
            else
                doctor_pass "Port 9444 (admin API): listening on $bind_9444"
            fi
        else
            doctor_fail "Port 9444 (admin API): not listening"
        fi

        # Port 9445 (admin UI)
        if ss -tlnp 2>/dev/null | grep -q ':9445 '; then
            local bind_9445
            bind_9445=$(ss -tlnp 2>/dev/null | grep ':9445 ' | awk '{print $4}' | head -1)
            if echo "$bind_9445" | grep -q '127.0.0.1'; then
                doctor_pass "Port 9445 (admin UI): listening on 127.0.0.1"
            elif echo "$bind_9445" | grep -q '0.0.0.0\|\*'; then
                doctor_fail "Port 9445 (admin UI): WARNING — bound to 0.0.0.0 (should be 127.0.0.1!)"
            else
                doctor_pass "Port 9445 (admin UI): listening on $bind_9445"
            fi
        else
            doctor_fail "Port 9445 (admin UI): not listening"
        fi
    else
        doctor_warn "ss not available — skipping network checks"
    fi

    # --- Data ---
    echo ""
    echo -e "${BOLD}Data:${NC}"

    if [[ -d "$BASTION_DATA" ]]; then
        if mountpoint -q "$BASTION_DATA" 2>/dev/null; then
            doctor_pass "$BASTION_DATA exists (disk mounted)"
        else
            doctor_pass "$BASTION_DATA exists"
        fi
    else
        doctor_fail "$BASTION_DATA does not exist"
    fi

    # Check key database files
    for db_file in "audit.db" "conversations.db" "memories.db" "budget.db" "usage.db"; do
        if [[ -f "$BASTION_DATA/$db_file" ]]; then
            local db_size
            db_size=$(stat -c '%s' "$BASTION_DATA/$db_file" 2>/dev/null || echo "0")
            if [[ "$db_size" -gt 0 ]]; then
                doctor_pass "$db_file: $(( db_size / 1024 ))KB"
            else
                doctor_warn "$db_file: empty"
            fi
        fi
        # Don't fail on missing DBs — they may not exist on this VM type
    done

    if [[ -f "$BASTION_ROOT/$VERSION_FILE" ]]; then
        doctor_pass "VERSION file: $(cat "$BASTION_ROOT/$VERSION_FILE")"
    else
        doctor_fail "VERSION file not found"
    fi

    # --- Configuration ---
    echo ""
    echo -e "${BOLD}Configuration:${NC}"

    if [[ -f "$BASTION_ROOT/.env" ]]; then
        doctor_pass ".env file present"
    else
        doctor_fail ".env file not found"
    fi

    if [[ -d "$BASTION_ROOT/certs" ]] && ls "$BASTION_ROOT/certs/"*.pem &>/dev/null 2>&1; then
        doctor_pass "TLS certificates found"
    elif [[ -d "$BASTION_ROOT/certs" ]] && ls "$BASTION_ROOT/certs/"*.crt &>/dev/null 2>&1; then
        doctor_pass "TLS certificates found"
    else
        doctor_fail "TLS certificates not found in $BASTION_ROOT/certs/"
    fi

    if [[ -f "$BASTION_DATA/admin-credentials.json" ]]; then
        doctor_pass "Admin credentials configured"
    else
        doctor_warn "Admin credentials not configured (auto-generated on first relay start)"
    fi

    # --- Summary ---
    echo ""
    echo -e "${BOLD}Summary:${NC} ${GREEN}$passed passed${NC}, ${RED}$failed failed${NC}, ${YELLOW}$warnings warnings${NC}"
    echo ""

    if [[ "$failed" -gt 0 ]]; then
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Install — Fresh Setup / Reset
# ---------------------------------------------------------------------------

cmd_install() {
    local vm_type="${1:-}"
    local fresh="${2:-false}"
    local wipe_data="${3:-false}"

    if [[ -z "$vm_type" ]]; then
        log_error "Missing --vm flag. Usage: bastion install --vm relay|ai"
        exit 1
    fi

    require_root

    if [[ "$fresh" == "true" ]]; then
        cmd_install_fresh "$vm_type" "$wipe_data"
        return
    fi

    log_header "Project Bastion — Fresh Install ($vm_type)"

    # Step 1: Create bastion user
    if id "$BASTION_USER" &>/dev/null; then
        log_info "User '$BASTION_USER' already exists"
    else
        log_step "Creating $BASTION_USER user..."
        useradd --system --create-home --shell /bin/bash "$BASTION_USER"
        log_info "User created"
    fi

    # Step 2: Set repository ownership
    if [[ -d "$BASTION_ROOT" ]]; then
        log_step "Setting ownership: $BASTION_ROOT → $BASTION_USER:$BASTION_GROUP"
        chown -R "$BASTION_USER:$BASTION_GROUP" "$BASTION_ROOT"
        log_info "Repository ownership set"
    else
        log_error "$BASTION_ROOT does not exist — clone the repo first"
        echo "    git clone $BASTION_REPO $BASTION_ROOT"
        exit 1
    fi

    # Step 3: Create data directory
    if [[ -d "$BASTION_DATA" ]]; then
        log_info "$BASTION_DATA already exists"
    else
        log_step "Creating $BASTION_DATA..."
        mkdir -p "$BASTION_DATA"
        log_info "Data directory created"
    fi
    chown -R "$BASTION_USER:$BASTION_GROUP" "$BASTION_DATA"

    # Step 4: Fix cache directories
    local bastion_home
    bastion_home=$(eval echo "~$BASTION_USER")
    mkdir -p "$bastion_home/.cache"
    chown -R "$BASTION_USER:$BASTION_GROUP" "$bastion_home/.cache"
    log_info "Cache directories configured"

    # Step 5: Install dependencies
    log_step "Installing dependencies..."
    sudo -u "$BASTION_USER" bash -c "cd '$BASTION_ROOT' && pnpm install --frozen-lockfile"
    log_info "Dependencies installed"

    # Step 6: Build packages
    log_step "Building packages..."
    sudo -u "$BASTION_USER" bash -c "cd '$BASTION_ROOT' && pnpm build"
    log_info "Build complete"

    # Step 7: Build admin UI (relay only)
    if [[ "$vm_type" == "relay" && -d "$BASTION_ROOT/packages/relay-admin-ui" ]]; then
        log_step "Building admin UI..."
        sudo -u "$BASTION_USER" bash -c "cd '$BASTION_ROOT' && pnpm --filter @bastion/relay-admin-ui run build:app" 2>&1 || log_warn "Admin UI build failed (non-fatal)"
        log_info "Admin UI built"
    fi

    # Step 8: Install systemd services
    case "$vm_type" in
        relay) install_systemd_relay ;;
        ai)    install_systemd_ai ;;
        *)     log_error "Unknown VM type: $vm_type (use: relay or ai)"; exit 1 ;;
    esac

    # Step 9: Install CLI
    install_cli

    log_header "Installation Complete"
    echo "  Next steps:"
    echo "    1. Configure TLS certificates in $BASTION_ROOT/certs/"
    echo "    2. Create .env file (see .env.example)"
    echo "    3. Run: bastion doctor"
    echo "    4. Run: bastion start --component $vm_type"
    echo ""
}

cmd_install_fresh() {
    local vm_type="$1"
    local wipe_data="$2"

    if [[ "$wipe_data" == "true" ]]; then
        log_header "Project Bastion — Fresh Reset ($vm_type) + DATA WIPE"
        echo ""
        echo -e "  ${RED}⚠️  This will PERMANENTLY DELETE ALL USER DATA.${NC}"
        echo "    This includes: audit trail, conversations, memories,"
        echo "    project files, skills, budget history, challenge config."
        echo ""
        echo -e "  ${RED}THIS CANNOT BE UNDONE.${NC}"
        echo ""
        echo -n "    Type 'DELETE ALL DATA' to confirm: "
        local confirm
        read -r confirm
        if [[ "$confirm" != "DELETE ALL DATA" ]]; then
            log_error "Confirmation failed — aborting"
            exit 1
        fi
    else
        log_header "Project Bastion — Fresh Reset ($vm_type)"
        echo ""
        echo -e "  ${YELLOW}⚠️  This will reset the Bastion $vm_type installation.${NC}"
        echo "    Configuration and build artifacts will be removed."
        echo "    User data (audit trail, conversations) will be PRESERVED."
        echo ""
        echo -n "    Type 'RESET' to confirm: "
        local confirm
        read -r confirm
        if [[ "$confirm" != "RESET" ]]; then
            log_error "Confirmation failed — aborting"
            exit 1
        fi
    fi

    # Step 1: Stop services
    log_step "Stopping services..."
    case "$vm_type" in
        relay)
            systemctl stop "$SVC_RELAY" 2>/dev/null || true
            systemctl stop "$SVC_ADMIN" 2>/dev/null || true
            ;;
        ai)
            systemctl stop "$SVC_AI" 2>/dev/null || true
            ;;
    esac
    log_info "Services stopped"

    # Step 2: Wipe data if requested
    if [[ "$wipe_data" == "true" ]]; then
        log_step "Removing user data from $BASTION_DATA/..."
        if mountpoint -q "$BASTION_DATA" 2>/dev/null; then
            # Mount point — delete contents, not the directory
            rm -rf "${BASTION_DATA:?}/"*
            log_info "All user data deleted (mount point preserved)"
        else
            rm -rf "${BASTION_DATA:?}/"*
            log_info "All user data deleted"
        fi
    fi

    # Step 3: Clean build artifacts
    log_step "Cleaning build artifacts..."
    cd "$BASTION_ROOT"
    rm -rf node_modules
    # Clean per-package artifacts
    find packages -maxdepth 2 -type d \( -name "node_modules" -o -name "dist" -o -name "build" -o -name ".svelte-kit" \) -exec rm -rf {} + 2>/dev/null || true
    log_info "node_modules, dist/, build/, .svelte-kit/ removed"

    # Step 4: Reinstall dependencies
    log_step "Reinstalling dependencies..."
    sudo -u "$BASTION_USER" bash -c "cd '$BASTION_ROOT' && pnpm install --frozen-lockfile"
    log_info "Dependencies installed"

    # Step 5: Rebuild
    log_step "Rebuilding..."
    sudo -u "$BASTION_USER" bash -c "cd '$BASTION_ROOT' && pnpm build"
    log_info "Build complete"

    # Step 6: Rebuild admin UI (relay only)
    if [[ "$vm_type" == "relay" && -d "$BASTION_ROOT/packages/relay-admin-ui" ]]; then
        log_step "Rebuilding admin UI..."
        sudo -u "$BASTION_USER" bash -c "cd '$BASTION_ROOT' && pnpm --filter @bastion/relay-admin-ui run build:app" 2>&1 || log_warn "Admin UI build failed (non-fatal)"
        log_info "Admin UI built"
    fi

    # Step 7: Reinstall systemd services
    log_step "Reinstalling systemd services..."
    case "$vm_type" in
        relay) install_systemd_relay ;;
        ai)    install_systemd_ai ;;
    esac

    log_header "Reset Complete"
    echo "  Run: bastion start --component $vm_type"
    echo ""
}

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

cmd_help() {
    echo "=== Project Bastion — CLI ==="
    echo ""
    echo "  Single-user architecture: all components run as '$BASTION_USER' user."
    echo "  VM-level isolation provides security separation."
    echo ""
    echo "Usage:"
    echo "  bastion version                                Show version"
    echo "  bastion status [component]                     Show service status"
    echo "  bastion doctor                                 Health check"
    echo "  bastion install --vm relay|ai                  Fresh install (root)"
    echo "  bastion install --fresh --vm relay|ai          Reset (preserves data)"
    echo "  bastion install --fresh --data --vm relay|ai   Reset + wipe all data"
    echo "  bastion update --component relay|ai            Pull, install, build"
    echo "  bastion restart --component relay|ai|admin|all"
    echo "  bastion start --component relay|ai|admin|all"
    echo "  bastion stop --component relay|ai|admin|all"
    echo "  bastion audit <component> [--live|--full]"
    echo "  bastion migrate --vm relay|ai                  One-time migration (root)"
    echo ""
    echo "Components: relay, admin, ai, all"
    echo ""
}

# ---------------------------------------------------------------------------
# Main — Argument Parser
# ---------------------------------------------------------------------------

COMMAND="${1:-help}"
shift || true

case "$COMMAND" in
    version)
        cmd_version
        ;;
    status)
        cmd_status "${1:-all}"
        ;;
    doctor)
        cmd_doctor
        ;;
    install)
        INSTALL_VM=""
        INSTALL_FRESH="false"
        INSTALL_DATA="false"
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --vm) INSTALL_VM="$2"; shift 2 ;;
                --fresh) INSTALL_FRESH="true"; shift ;;
                --data) INSTALL_DATA="true"; shift ;;
                *) INSTALL_VM="$1"; shift ;;
            esac
        done
        cmd_install "$INSTALL_VM" "$INSTALL_FRESH" "$INSTALL_DATA"
        ;;
    update)
        COMPONENT=""
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --component) COMPONENT="$2"; shift 2 ;;
                *) COMPONENT="$1"; shift ;;
            esac
        done
        cmd_update "$COMPONENT"
        ;;
    restart)
        COMPONENT="all"
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --component) COMPONENT="$2"; shift 2 ;;
                *) COMPONENT="$1"; shift ;;
            esac
        done
        cmd_restart "$COMPONENT"
        ;;
    start)
        COMPONENT="all"
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --component) COMPONENT="$2"; shift 2 ;;
                *) COMPONENT="$1"; shift ;;
            esac
        done
        cmd_start "$COMPONENT"
        ;;
    stop)
        COMPONENT="all"
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --component) COMPONENT="$2"; shift 2 ;;
                *) COMPONENT="$1"; shift ;;
            esac
        done
        cmd_stop "$COMPONENT"
        ;;
    audit)
        AUDIT_COMPONENT=""
        AUDIT_MODE=""
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --live|--full) AUDIT_MODE="$1"; shift ;;
                *) AUDIT_COMPONENT="$1"; shift ;;
            esac
        done
        cmd_audit "$AUDIT_COMPONENT" "$AUDIT_MODE"
        ;;
    migrate)
        VM_TYPE=""
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --vm) VM_TYPE="$2"; shift 2 ;;
                *) VM_TYPE="$1"; shift ;;
            esac
        done
        cmd_migrate "$VM_TYPE"
        ;;
    help|--help|-h)
        cmd_help
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        cmd_help
        exit 1
        ;;
esac

