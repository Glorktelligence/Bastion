#!/usr/bin/env bash
#
# Bastion AI Client VM — Automated Setup Script
#
# Provisions a Debian 12 VM as a hardened Bastion AI client environment.
# Creates user, configures filesystem, installs dependencies, applies
# security hardening (AppArmor, nftables, systemd, cgroups).
#
# Usage:
#   # Dry run — show what would be done without making changes
#   sudo bash setup-ai-vm.sh --dry-run
#
#   # Full setup
#   sudo bash setup-ai-vm.sh
#
#   # Skip Node.js installation (if already installed)
#   sudo bash setup-ai-vm.sh --skip-nodejs
#
# Prerequisites:
#   - Debian 12 minimal installation
#   - Root access (sudo)
#   - Network connectivity (for package installation)
#   - Static IP already configured (10.0.50.10/24)
#
# Copyright 2026 Glorktelligence — Harry Smith
# Licensed under the Apache License, Version 2.0

set -euo pipefail

# ===========================================================================
# Configuration
# ===========================================================================

readonly BASTION_USER="bastion-ai"
readonly BASTION_GROUP="bastion-ai"
readonly APP_DIR="/opt/bastion-ai"
readonly WORKSPACE_DIR="/var/lib/bastion-ai"
readonly INTAKE_DIR="${WORKSPACE_DIR}/intake"
readonly OUTBOUND_DIR="${WORKSPACE_DIR}/outbound"
readonly WORKSPACE_DISK="/dev/sdb"

readonly RELAY_IP="10.0.30.10"
readonly RELAY_PORT="9443"
readonly GATEWAY_IP="10.0.50.1"
readonly AI_VM_IP="10.0.50.10"

# Resource limits (cgroup)
readonly CPU_QUOTA="300%"          # 3 of 4 cores max
readonly MEMORY_MAX="3G"           # 3 of 4 GB max
readonly MEMORY_HIGH="2560M"       # Soft limit — reclaim pressure starts here
readonly IO_WEIGHT="100"           # Default I/O weight (100 = normal)
readonly PIDS_MAX="128"            # Max processes for AI client

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ===========================================================================
# Flags
# ===========================================================================

DRY_RUN=false
SKIP_NODEJS=false

for arg in "$@"; do
    case "$arg" in
        --dry-run)   DRY_RUN=true ;;
        --skip-nodejs) SKIP_NODEJS=true ;;
        --help)
            echo "Usage: sudo bash setup-ai-vm.sh [--dry-run] [--skip-nodejs]"
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg"
            exit 1
            ;;
    esac
done

# ===========================================================================
# Helpers
# ===========================================================================

log_info()  { echo -e "\033[0;32m[INFO]\033[0m  $*"; }
log_warn()  { echo -e "\033[0;33m[WARN]\033[0m  $*"; }
log_error() { echo -e "\033[0;31m[ERROR]\033[0m $*"; }
log_step()  { echo -e "\n\033[1;36m==> $*\033[0m"; }

run() {
    if $DRY_RUN; then
        echo "  [DRY RUN] $*"
    else
        "$@"
    fi
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (sudo)."
        exit 1
    fi
}

# ===========================================================================
# Step 1: System packages
# ===========================================================================

install_packages() {
    log_step "Installing required system packages"

    run apt-get update -qq
    run apt-get install -y -qq \
        apparmor \
        apparmor-utils \
        nftables \
        ca-certificates \
        curl \
        gnupg \
        openssl \
        jq

    # Ensure AppArmor and nftables are enabled
    run systemctl enable apparmor
    run systemctl enable nftables
}

# ===========================================================================
# Step 2: Node.js installation
# ===========================================================================

install_nodejs() {
    if $SKIP_NODEJS; then
        log_warn "Skipping Node.js installation (--skip-nodejs)"
        return
    fi

    log_step "Installing Node.js 24 LTS"

    if command -v node &>/dev/null; then
        local current_version
        current_version=$(node --version)
        log_info "Node.js already installed: ${current_version}"

        if [[ "$current_version" == v24* ]]; then
            log_info "Node.js 24 already installed, skipping"
            return
        else
            log_warn "Node.js ${current_version} found, upgrading to 24"
        fi
    fi

    run curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
    run apt-get install -y -qq nodejs
    run corepack enable
    run corepack prepare pnpm@10 --activate

    log_info "Node.js $(node --version) installed"
}

# ===========================================================================
# Step 3: User and directory setup
# ===========================================================================

setup_user() {
    log_step "Creating bastion-ai user and directories"

    # Create system user (no login shell for security)
    if id "$BASTION_USER" &>/dev/null; then
        log_info "User ${BASTION_USER} already exists"
    else
        run useradd -r -m -s /usr/sbin/nologin "$BASTION_USER"
        log_info "Created user: ${BASTION_USER}"
    fi

    # Create application directory
    run mkdir -p "$APP_DIR"
    run chown "${BASTION_USER}:${BASTION_GROUP}" "$APP_DIR"
    run chmod 750 "$APP_DIR"

    # Create workspace directory structure
    run mkdir -p "$INTAKE_DIR" "$OUTBOUND_DIR"
    run chown -R "${BASTION_USER}:${BASTION_GROUP}" "$WORKSPACE_DIR"
    run chmod 750 "$WORKSPACE_DIR"
    run chmod 750 "$INTAKE_DIR"
    run chmod 750 "$OUTBOUND_DIR"
}

# ===========================================================================
# Step 4: Mount workspace disk (if separate disk present)
# ===========================================================================

setup_workspace_disk() {
    log_step "Configuring workspace disk"

    if [[ ! -b "$WORKSPACE_DISK" ]]; then
        log_warn "Workspace disk ${WORKSPACE_DISK} not found — using root filesystem"
        log_warn "For production, attach a separate disk for file isolation"
        return
    fi

    # Check if already mounted
    if mountpoint -q "$WORKSPACE_DIR" 2>/dev/null; then
        log_info "Workspace already mounted at ${WORKSPACE_DIR}"
        return
    fi

    # Format if no filesystem detected
    if ! blkid "$WORKSPACE_DISK" &>/dev/null; then
        log_info "Formatting ${WORKSPACE_DISK} as ext4"
        run mkfs.ext4 -L bastion-workspace "$WORKSPACE_DISK"
    fi

    # Add fstab entry if not present
    if ! grep -q "$WORKSPACE_DISK" /etc/fstab; then
        log_info "Adding fstab entry for workspace disk"
        run bash -c "echo '${WORKSPACE_DISK} ${WORKSPACE_DIR} ext4 defaults,nosuid,nodev,noexec 0 2' >> /etc/fstab"
    fi

    run mount -a
    run chown -R "${BASTION_USER}:${BASTION_GROUP}" "$WORKSPACE_DIR"

    log_info "Workspace disk mounted at ${WORKSPACE_DIR} with nosuid,nodev,noexec"
}

# ===========================================================================
# Step 5: nftables local firewall
# ===========================================================================

setup_firewall() {
    log_step "Configuring local nftables firewall"

    local nft_source="${SCRIPT_DIR}/../firewall/ai-client-nftables.conf"

    if [[ -f "$nft_source" ]]; then
        run cp "$nft_source" /etc/nftables.conf
        log_info "Copied nftables rules from repo"
    else
        log_warn "nftables config not found at ${nft_source}"
        log_warn "Please copy ai-client-nftables.conf to /etc/nftables.conf manually"
        return
    fi

    run systemctl restart nftables
    log_info "nftables firewall applied"
}

# ===========================================================================
# Step 6: AppArmor profile
# ===========================================================================

setup_apparmor() {
    log_step "Installing AppArmor profile"

    local profile_source="${SCRIPT_DIR}/../apparmor/bastion-ai-client"

    if [[ -f "$profile_source" ]]; then
        run cp "$profile_source" /etc/apparmor.d/bastion-ai-client
        log_info "Copied AppArmor profile from repo"
    else
        log_warn "AppArmor profile not found at ${profile_source}"
        log_warn "Please copy bastion-ai-client to /etc/apparmor.d/ manually"
        return
    fi

    # Load in complain mode first for safe testing
    log_info "Loading AppArmor profile in COMPLAIN mode (test first, then enforce)"
    run aa-complain /etc/apparmor.d/bastion-ai-client

    log_warn "AppArmor loaded in COMPLAIN mode. After testing, enforce with:"
    log_warn "  sudo aa-enforce /etc/apparmor.d/bastion-ai-client"
}

# ===========================================================================
# Step 7: Cgroup resource limits (via systemd slice)
# ===========================================================================

setup_cgroups() {
    log_step "Configuring cgroup resource limits"

    local slice_dir="/etc/systemd/system/bastion-ai-client.service.d"
    run mkdir -p "$slice_dir"

    # Create override with resource limits
    run bash -c "cat > ${slice_dir}/resources.conf << 'CGROUP_EOF'
# Bastion AI Client — Resource limits (cgroup v2 via systemd)
# These supplement the limits in the main service file.

[Service]
# CPU: max 3 of 4 cores (75% of VM)
CPUQuota=${CPU_QUOTA}

# Memory: hard limit 3GB, soft limit 2.5GB
MemoryMax=${MEMORY_MAX}
MemoryHigh=${MEMORY_HIGH}

# Prevent memory swap to avoid OOM delays
MemorySwapMax=0

# I/O weight (relative priority, 100 = normal)
IOWeight=${IO_WEIGHT}

# Max PIDs — prevent fork bombs
TasksMax=${PIDS_MAX}
CGROUP_EOF"

    log_info "Cgroup limits configured: CPU=${CPU_QUOTA}, Mem=${MEMORY_MAX} (soft ${MEMORY_HIGH}), PIDs=${PIDS_MAX}"
}

# ===========================================================================
# Step 8: Systemd service
# ===========================================================================

setup_systemd() {
    log_step "Installing systemd service"

    local service_source="${SCRIPT_DIR}/../systemd/bastion-ai-client.service"

    if [[ -f "$service_source" ]]; then
        run cp "$service_source" /etc/systemd/system/bastion-ai-client.service
        log_info "Copied systemd service from repo"
    else
        log_warn "Service file not found at ${service_source}"
        log_warn "Please copy bastion-ai-client.service to /etc/systemd/system/ manually"
        return
    fi

    run systemctl daemon-reload
    run systemctl enable bastion-ai-client

    log_info "Systemd service installed and enabled (not started — deploy app first)"
}

# ===========================================================================
# Step 9: Create .env template
# ===========================================================================

setup_env_template() {
    log_step "Creating .env template"

    local env_file="${APP_DIR}/.env"

    if [[ -f "$env_file" ]]; then
        log_info ".env file already exists — skipping"
        return
    fi

    run bash -c "cat > ${env_file} << 'ENV_EOF'
# Bastion AI Client — Environment Configuration
# This file contains sensitive credentials. Protect it.
#
# Permissions: chmod 600 (read/write owner only)
# Owner: bastion-ai:bastion-ai

# Relay connection
BASTION_RELAY_URL=wss://10.0.30.10:9443

# AI Client identity
BASTION_AI_CLIENT_ID=ai-client-production
BASTION_AI_DISPLAY_NAME=Claude (Bastion)
BASTION_PROVIDER_ID=anthropic

# Anthropic API key — NEVER expose outside this VM
# ANTHROPIC_API_KEY=sk-ant-...

# Safety configuration (optional — defaults are secure)
# BASTION_HIGH_RISK_HOURS_START=0
# BASTION_HIGH_RISK_HOURS_END=6
# BASTION_PATTERN_SENSITIVITY=medium
ENV_EOF"

    run chown "${BASTION_USER}:${BASTION_GROUP}" "$env_file"
    run chmod 600 "$env_file"

    log_info "Created .env template at ${env_file}"
    log_warn "IMPORTANT: Edit ${env_file} and add your ANTHROPIC_API_KEY before starting"
}

# ===========================================================================
# Step 10: Verification
# ===========================================================================

verify_setup() {
    log_step "Running verification checks"

    local passed=0
    local failed=0

    check() {
        local description="$1"
        shift
        if "$@" &>/dev/null; then
            log_info "PASS: ${description}"
            ((passed++))
        else
            log_error "FAIL: ${description}"
            ((failed++))
        fi
    }

    # User exists
    check "User ${BASTION_USER} exists" id "$BASTION_USER"

    # Directories exist with correct ownership
    check "App directory exists" test -d "$APP_DIR"
    check "Workspace directory exists" test -d "$WORKSPACE_DIR"
    check "Intake directory exists" test -d "$INTAKE_DIR"
    check "Outbound directory exists" test -d "$OUTBOUND_DIR"

    # Node.js installed
    check "Node.js installed" command -v node

    # nftables active
    check "nftables service active" systemctl is-active nftables

    # AppArmor profile loaded
    check "AppArmor profile loaded" aa-status --json

    # Systemd service exists
    check "Systemd service installed" systemctl cat bastion-ai-client

    # .env file permissions
    if [[ -f "${APP_DIR}/.env" ]]; then
        local perms
        perms=$(stat -c "%a" "${APP_DIR}/.env")
        if [[ "$perms" == "600" ]]; then
            log_info "PASS: .env permissions are 600"
            ((passed++))
        else
            log_error "FAIL: .env permissions are ${perms} (should be 600)"
            ((failed++))
        fi
    fi

    echo ""
    log_info "Verification complete: ${passed} passed, ${failed} failed"

    if [[ $failed -gt 0 ]]; then
        log_error "Some checks failed — review output above"
        return 1
    fi

    return 0
}

# ===========================================================================
# Network isolation tests (optional, run separately)
# ===========================================================================

test_network_isolation() {
    log_step "Testing network isolation"

    log_info "Testing relay connection (should succeed)..."
    if nc -zv -w3 "$RELAY_IP" "$RELAY_PORT" 2>&1; then
        log_info "PASS: Relay connection"
    else
        log_error "FAIL: Cannot reach relay at ${RELAY_IP}:${RELAY_PORT}"
    fi

    log_info "Testing external HTTPS (should succeed)..."
    if curl -sI --connect-timeout 5 https://api.anthropic.com &>/dev/null; then
        log_info "PASS: External HTTPS"
    else
        log_error "FAIL: Cannot reach external HTTPS"
    fi

    log_info "Testing internal lateral movement (should FAIL)..."
    if nc -zv -w3 10.0.10.1 22 2>&1; then
        log_error "FAIL: Can reach internal network (ISOLATION BREACH)"
    else
        log_info "PASS: Internal network blocked"
    fi

    log_info "Testing DNS to external resolver (should FAIL)..."
    if dig @8.8.8.8 +short +timeout=3 api.anthropic.com &>/dev/null; then
        log_error "FAIL: Can reach external DNS (exfiltration risk)"
    else
        log_info "PASS: External DNS blocked"
    fi
}

# ===========================================================================
# Main
# ===========================================================================

main() {
    check_root

    if $DRY_RUN; then
        log_warn "DRY RUN MODE — no changes will be made"
        echo ""
    fi

    log_info "Bastion AI Client VM Setup"
    log_info "=========================="
    echo ""

    install_packages
    install_nodejs
    setup_user
    setup_workspace_disk
    setup_firewall
    setup_apparmor
    setup_cgroups
    setup_systemd
    setup_env_template

    if ! $DRY_RUN; then
        verify_setup
    fi

    echo ""
    log_step "Setup complete!"
    echo ""
    log_info "Next steps:"
    log_info "  1. Deploy Bastion AI client to ${APP_DIR}"
    log_info "  2. Edit ${APP_DIR}/.env and add your ANTHROPIC_API_KEY"
    log_info "  3. Test AppArmor in complain mode, then enforce:"
    log_info "     sudo aa-enforce /etc/apparmor.d/bastion-ai-client"
    log_info "  4. Start the service:"
    log_info "     sudo systemctl start bastion-ai-client"
    log_info "  5. Run network isolation tests:"
    log_info "     sudo bash setup-ai-vm.sh --test-network"
    log_info "  6. Monitor logs:"
    log_info "     journalctl -u bastion-ai-client -f"
}

# Handle --test-network flag separately
if [[ "${1:-}" == "--test-network" ]]; then
    check_root
    test_network_isolation
    exit $?
fi

main
