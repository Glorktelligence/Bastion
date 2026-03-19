#!/usr/bin/env bash
#
# Bastion Component Setup — Automated VM/LXC Provisioning
#
# Intelligent setup script that auto-detects the Bastion component type,
# identifies and safely configures disk drives, and applies hardening.
#
# SAFETY: The OS disk is auto-detected and PROTECTED. The script will
# never format or modify the disk containing the root filesystem.
# Workspace disks are identified by label or by elimination, and the
# operator must confirm before any formatting occurs.
#
# Usage:
#   # Auto-detect component and configure
#   sudo bash setup-bastion.sh
#
#   # Explicit component type
#   sudo bash setup-bastion.sh --component ai-client
#   sudo bash setup-bastion.sh --component relay
#
#   # Dry run — show what would be done
#   sudo bash setup-bastion.sh --dry-run
#
#   # Fix broken fstab entries (emergency recovery)
#   sudo bash setup-bastion.sh --fix-fstab
#
#   # Network isolation tests
#   sudo bash setup-bastion.sh --test-network
#
#   # Skip Node.js installation
#   sudo bash setup-bastion.sh --skip-nodejs
#
# Copyright 2026 Glorktelligence — Harry Smith
# Licensed under the Apache License, Version 2.0

set -euo pipefail

# ===========================================================================
# Configuration — shared
# ===========================================================================

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly BASTION_LABEL_PREFIX="bastion"

# Relay configuration
readonly RELAY_USER="bastion"
readonly RELAY_GROUP="bastion"
readonly RELAY_APP_DIR="/opt/bastion"
readonly RELAY_WORKSPACE_DIR="/var/lib/bastion"
readonly RELAY_DISK_LABEL="bastion-audit"
readonly RELAY_EXPECTED_DISK_SIZE_GB=10
readonly RELAY_IP="10.0.30.10"
readonly RELAY_PORT="9443"

# AI Client configuration
readonly AI_USER="bastion-ai"
readonly AI_GROUP="bastion-ai"
readonly AI_APP_DIR="/opt/bastion-ai"
readonly AI_WORKSPACE_DIR="/var/lib/bastion-ai"
readonly AI_DISK_LABEL="bastion-workspace"
readonly AI_EXPECTED_DISK_SIZE_GB=20
readonly AI_GATEWAY_IP="10.0.50.1"
readonly AI_VM_IP="10.0.50.10"

# Resource limits (AI client only)
readonly CPU_QUOTA="300%"
readonly MEMORY_MAX="3G"
readonly MEMORY_HIGH="2560M"
readonly IO_WEIGHT="100"
readonly PIDS_MAX="128"

# ===========================================================================
# Runtime state
# ===========================================================================

DRY_RUN=false
SKIP_NODEJS=false
FIX_FSTAB=false
COMPONENT=""          # "ai-client" or "relay" — auto-detected if not set
BASTION_USER=""
BASTION_GROUP=""
APP_DIR=""
WORKSPACE_DIR=""
DISK_LABEL=""
EXPECTED_DISK_SIZE_GB=0

# ===========================================================================
# Argument parsing
# ===========================================================================

for arg in "$@"; do
    case "$arg" in
        --dry-run)        DRY_RUN=true ;;
        --skip-nodejs)    SKIP_NODEJS=true ;;
        --fix-fstab)      FIX_FSTAB=true ;;
        --component=*)    COMPONENT="${arg#*=}" ;;
        --test-network)   ;; # handled below
        --help)
            echo "Usage: sudo bash setup-bastion.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --component=TYPE   Component type: 'ai-client' or 'relay'"
            echo "  --dry-run          Show what would be done without changes"
            echo "  --fix-fstab        Fix broken fstab entries and exit"
            echo "  --skip-nodejs      Skip Node.js installation"
            echo "  --test-network     Run network isolation tests"
            echo "  --help             Show this help"
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg (use --help)"
            exit 1
            ;;
    esac
done

# ===========================================================================
# Helpers
# ===========================================================================

log_info()    { echo -e "\033[0;32m[INFO]\033[0m  $*"; }
log_warn()    { echo -e "\033[0;33m[WARN]\033[0m  $*"; }
log_error()   { echo -e "\033[0;31m[ERROR]\033[0m $*"; }
log_step()    { echo -e "\n\033[1;36m==> $*\033[0m"; }
log_danger()  { echo -e "\033[1;31m[DANGER]\033[0m $*"; }

run() {
    if $DRY_RUN; then
        echo "  [DRY RUN] $*"
    else
        "$@"
    fi
}

confirm() {
    local prompt="$1"
    if $DRY_RUN; then
        echo "  [DRY RUN] Would ask: ${prompt}"
        return 0
    fi
    read -r -p "${prompt} [y/N]: " response
    [[ "$response" =~ ^[Yy]$ ]]
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (sudo)."
        exit 1
    fi
}

# ===========================================================================
# Component auto-detection
# ===========================================================================

detect_component() {
    log_step "Detecting Bastion component type"

    if [[ -n "$COMPONENT" ]]; then
        log_info "Component explicitly set: ${COMPONENT}"
    else
        # Auto-detect based on hostname
        local hostname
        hostname=$(hostname)

        if [[ "$hostname" == *"ai"* ]]; then
            COMPONENT="ai-client"
            log_info "Auto-detected component from hostname '${hostname}': ai-client"
        elif [[ "$hostname" == *"bastion"* && "$hostname" != *"ai"* ]]; then
            COMPONENT="relay"
            log_info "Auto-detected component from hostname '${hostname}': relay"
        else
            log_warn "Could not auto-detect component from hostname '${hostname}'"
            echo ""
            echo "Which Bastion component is this VM?"
            echo "  1) AI Client (isolated execution environment)"
            echo "  2) Relay (message routing, audit, quarantine)"
            read -r -p "Select [1/2]: " choice
            case "$choice" in
                1) COMPONENT="ai-client" ;;
                2) COMPONENT="relay" ;;
                *)
                    log_error "Invalid choice. Exiting."
                    exit 1
                    ;;
            esac
        fi
    fi

    # Set component-specific variables
    case "$COMPONENT" in
        ai-client)
            BASTION_USER="$AI_USER"
            BASTION_GROUP="$AI_GROUP"
            APP_DIR="$AI_APP_DIR"
            WORKSPACE_DIR="$AI_WORKSPACE_DIR"
            DISK_LABEL="$AI_DISK_LABEL"
            EXPECTED_DISK_SIZE_GB="$AI_EXPECTED_DISK_SIZE_GB"
            ;;
        relay)
            BASTION_USER="$RELAY_USER"
            BASTION_GROUP="$RELAY_GROUP"
            APP_DIR="$RELAY_APP_DIR"
            WORKSPACE_DIR="$RELAY_WORKSPACE_DIR"
            DISK_LABEL="$RELAY_DISK_LABEL"
            EXPECTED_DISK_SIZE_GB="$RELAY_EXPECTED_DISK_SIZE_GB"
            ;;
        *)
            log_error "Unknown component: ${COMPONENT}. Use 'ai-client' or 'relay'."
            exit 1
            ;;
    esac

    log_info "Component: ${COMPONENT}"
    log_info "User: ${BASTION_USER}"
    log_info "App dir: ${APP_DIR}"
    log_info "Workspace: ${WORKSPACE_DIR}"
    log_info "Disk label: ${DISK_LABEL}"
}

# ===========================================================================
# Disk detection — SAFE, intelligent, OS-aware
# ===========================================================================

# Globals set by detect_workspace_disk()
OS_DISK=""
WORKSPACE_DISK=""

detect_workspace_disk() {
    log_step "Detecting disks (OS protection enabled)"

    # -----------------------------------------------------------------------
    # 1. Identify the OS disk — the one containing the root mount
    # -----------------------------------------------------------------------
    local root_device
    root_device=$(findmnt -n -o SOURCE / | sed 's/[0-9]*$//' | sed 's/p[0-9]*$//')
    # Strip partition suffix: /dev/sda1 → /dev/sda, /dev/nvme0n1p1 → /dev/nvme0n1
    OS_DISK=$(readlink -f "$root_device" 2>/dev/null || echo "$root_device")

    log_info "OS disk detected: ${OS_DISK}"
    log_danger "OS disk is PROTECTED — this script will NEVER touch it"

    # -----------------------------------------------------------------------
    # 2. List all block devices (disks only, no partitions, no rom)
    # -----------------------------------------------------------------------
    echo ""
    log_info "All detected disks:"
    echo "  ────────────────────────────────────────────────"

    local candidate_disks=()

    while IFS= read -r line; do
        local dev size type
        dev=$(echo "$line" | awk '{print $1}')
        size=$(echo "$line" | awk '{print $2}')
        type=$(echo "$line" | awk '{print $3}')

        [[ "$type" != "disk" ]] && continue
        [[ "$dev" == sr* || "$dev" == fd* || "$dev" == loop* ]] && continue

        local full_dev="/dev/${dev}"
        local label=""
        local fstype=""
        local is_os="no"
        local status=""

        # Check if this is the OS disk
        if [[ "$full_dev" == "$OS_DISK" ]]; then
            is_os="yes"
            status="[OS — PROTECTED]"
        else
            # Check for existing filesystem label
            label=$(blkid -s LABEL -o value "$full_dev" 2>/dev/null || true)
            fstype=$(blkid -s TYPE -o value "$full_dev" 2>/dev/null || true)

            if [[ -n "$label" ]]; then
                status="[label: ${label}, fs: ${fstype}]"
            elif [[ -n "$fstype" ]]; then
                status="[fs: ${fstype}, no label]"
            else
                status="[unformatted]"
            fi

            candidate_disks+=("$full_dev")
        fi

        printf "  %-12s %-8s %-4s %s\n" "$full_dev" "$size" "$is_os" "$status"

    done < <(lsblk -dn -o NAME,SIZE,TYPE 2>/dev/null)

    echo "  ────────────────────────────────────────────────"
    echo ""

    # -----------------------------------------------------------------------
    # 3. Find the workspace disk
    # -----------------------------------------------------------------------

    # Strategy 1: Look for a disk already labelled for this component
    for dev in "${candidate_disks[@]}"; do
        local label
        label=$(blkid -s LABEL -o value "$dev" 2>/dev/null || true)
        if [[ "$label" == "$DISK_LABEL" ]]; then
            WORKSPACE_DISK="$dev"
            log_info "Found workspace disk by label '${DISK_LABEL}': ${dev}"
            return
        fi
    done

    # Strategy 2: Look for an unformatted disk of the expected size
    for dev in "${candidate_disks[@]}"; do
        local fstype size_bytes size_gb
        fstype=$(blkid -s TYPE -o value "$dev" 2>/dev/null || true)

        if [[ -z "$fstype" ]]; then
            # Unformatted disk — check size
            size_bytes=$(blockdev --getsize64 "$dev" 2>/dev/null || echo 0)
            size_gb=$(( size_bytes / 1073741824 ))

            if [[ $size_gb -ge $(( EXPECTED_DISK_SIZE_GB - 2 )) && $size_gb -le $(( EXPECTED_DISK_SIZE_GB + 2 )) ]]; then
                WORKSPACE_DISK="$dev"
                log_info "Found unformatted candidate disk (${size_gb}GB): ${dev}"
                return
            fi
        fi
    done

    # Strategy 3: Single non-OS disk — must be the workspace
    if [[ ${#candidate_disks[@]} -eq 1 ]]; then
        WORKSPACE_DISK="${candidate_disks[0]}"
        log_info "Single non-OS disk found: ${WORKSPACE_DISK}"
        return
    fi

    # Strategy 4: Multiple candidates — ask the operator
    if [[ ${#candidate_disks[@]} -gt 1 ]]; then
        log_warn "Multiple candidate disks found. Please select the workspace disk:"
        local i=1
        for dev in "${candidate_disks[@]}"; do
            local size label fstype
            size=$(lsblk -dn -o SIZE "$dev" 2>/dev/null || echo "??")
            label=$(blkid -s LABEL -o value "$dev" 2>/dev/null || echo "none")
            fstype=$(blkid -s TYPE -o value "$dev" 2>/dev/null || echo "unformatted")
            echo "  ${i}) ${dev} — ${size}, label: ${label}, fs: ${fstype}"
            ((i++))
        done
        read -r -p "Select disk number: " choice
        if [[ "$choice" -ge 1 && "$choice" -le ${#candidate_disks[@]} ]]; then
            WORKSPACE_DISK="${candidate_disks[$((choice-1))]}"
            log_info "Selected: ${WORKSPACE_DISK}"
            return
        fi
    fi

    # No candidate found
    log_warn "No suitable workspace disk found — using root filesystem"
    log_warn "For production, attach a separate disk for file isolation"
    WORKSPACE_DISK=""
}

# ===========================================================================
# Workspace disk setup — format, label, mount safely
# ===========================================================================

setup_workspace_disk() {
    log_step "Configuring workspace disk"

    if [[ -z "$WORKSPACE_DISK" ]]; then
        log_warn "No workspace disk configured — skipping"
        log_warn "Workspace will use root filesystem at ${WORKSPACE_DIR}"
        run mkdir -p "$WORKSPACE_DIR"
        return
    fi

    # Safety check: NEVER touch the OS disk
    if [[ "$WORKSPACE_DISK" == "$OS_DISK" ]]; then
        log_error "SAFETY ABORT: Workspace disk '${WORKSPACE_DISK}' is the OS disk!"
        log_error "This should never happen. Aborting to protect the system."
        exit 1
    fi

    # Check if already correctly mounted
    if mountpoint -q "$WORKSPACE_DIR" 2>/dev/null; then
        local mounted_dev
        mounted_dev=$(findmnt -n -o SOURCE "$WORKSPACE_DIR")
        log_info "Workspace already mounted at ${WORKSPACE_DIR} from ${mounted_dev}"
        return
    fi

    # -----------------------------------------------------------------------
    # Format if needed (with confirmation)
    # -----------------------------------------------------------------------
    local current_fs
    current_fs=$(blkid -s TYPE -o value "$WORKSPACE_DISK" 2>/dev/null || true)
    local current_label
    current_label=$(blkid -s LABEL -o value "$WORKSPACE_DISK" 2>/dev/null || true)

    if [[ -z "$current_fs" ]]; then
        # Unformatted — format with label
        log_info "Disk ${WORKSPACE_DISK} is unformatted"

        if confirm "Format ${WORKSPACE_DISK} as ext4 with label '${DISK_LABEL}'?"; then
            run mkfs.ext4 -L "$DISK_LABEL" "$WORKSPACE_DISK"
            log_info "Formatted ${WORKSPACE_DISK} as ext4 (label: ${DISK_LABEL})"
        else
            log_warn "Skipping format — disk must be formatted before mounting"
            return
        fi

    elif [[ "$current_label" != "$DISK_LABEL" ]]; then
        # Has filesystem but wrong/missing label
        log_warn "Disk ${WORKSPACE_DISK} has filesystem '${current_fs}' but label is '${current_label:-<none>}'"

        if [[ -n "$current_fs" && "$current_fs" == "ext4" ]]; then
            if confirm "Set label to '${DISK_LABEL}' on existing ext4 filesystem?"; then
                run e2label "$WORKSPACE_DISK" "$DISK_LABEL"
                log_info "Label set to '${DISK_LABEL}'"
            fi
        else
            log_warn "Filesystem is ${current_fs} — manual intervention needed"
            return
        fi
    else
        log_info "Disk ${WORKSPACE_DISK} already formatted with label '${DISK_LABEL}'"
    fi

    # -----------------------------------------------------------------------
    # Fix fstab — use LABEL= instead of device path
    # -----------------------------------------------------------------------
    local mount_source="LABEL=${DISK_LABEL}"
    local mount_opts="defaults,nosuid,nodev,noexec"

    # Remove any existing broken fstab entries for this mount point
    if grep -q "$WORKSPACE_DIR" /etc/fstab; then
        log_warn "Existing fstab entry found for ${WORKSPACE_DIR} — replacing with label-based mount"
        run sed -i "\|${WORKSPACE_DIR}|d" /etc/fstab
    fi

    # Add correct label-based entry
    log_info "Adding fstab entry: ${mount_source} → ${WORKSPACE_DIR}"
    run bash -c "echo '${mount_source} ${WORKSPACE_DIR} ext4 ${mount_opts} 0 2' >> /etc/fstab"

    # -----------------------------------------------------------------------
    # Create mount point and mount
    # -----------------------------------------------------------------------
    run mkdir -p "$WORKSPACE_DIR"
    run systemctl daemon-reload
    run mount -a

    # Verify mount succeeded
    if ! $DRY_RUN; then
        if mountpoint -q "$WORKSPACE_DIR" 2>/dev/null; then
            log_info "Workspace mounted successfully at ${WORKSPACE_DIR}"
        else
            log_error "Mount failed! Check fstab and disk status"
            return 1
        fi
    fi

    # Set ownership and create subdirectories
    if [[ "$COMPONENT" == "ai-client" ]]; then
        run mkdir -p "${WORKSPACE_DIR}/intake" "${WORKSPACE_DIR}/outbound"
    fi
    run chown -R "${BASTION_USER}:${BASTION_GROUP}" "$WORKSPACE_DIR"
    run chmod 750 "$WORKSPACE_DIR"

    log_info "Workspace disk ready: ${WORKSPACE_DISK} → ${WORKSPACE_DIR} (${mount_opts})"
}

# ===========================================================================
# fstab repair (standalone mode)
# ===========================================================================

fix_fstab() {
    log_step "Scanning fstab for broken Bastion mount entries"

    local fixed=0

    # Check for device-path entries that should be label-based
    while IFS= read -r line; do
        # Skip comments and empty lines
        [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue

        local dev mount_point
        dev=$(echo "$line" | awk '{print $1}')
        mount_point=$(echo "$line" | awk '{print $2}')

        # Only check Bastion-related mount points
        [[ "$mount_point" != *"bastion"* ]] && continue

        log_info "Found Bastion fstab entry: ${dev} → ${mount_point}"

        # Check 1: Is this pointing at the OS disk?
        local root_disk
        root_disk=$(findmnt -n -o SOURCE / | sed 's/[0-9]*$//' | sed 's/p[0-9]*$//')

        if [[ "$dev" == "$root_disk" || "$dev" == "${root_disk}"* ]]; then
            log_danger "CRITICAL: Entry points to OS disk! ${dev} is the root device"
            log_info "This is the bug — ${dev} is your OS, not the workspace disk"

            # Find the correct disk
            log_info "Scanning for correct workspace disk..."
            local correct_dev=""

            while IFS= read -r disk_line; do
                local disk_name disk_type
                disk_name="/dev/$(echo "$disk_line" | awk '{print $1}')"
                disk_type=$(echo "$disk_line" | awk '{print $3}')

                [[ "$disk_type" != "disk" ]] && continue
                [[ "$disk_name" == "$root_disk" ]] && continue
                [[ "$disk_name" == /dev/sr* || "$disk_name" == /dev/fd* ]] && continue

                correct_dev="$disk_name"
                local disk_size
                disk_size=$(echo "$disk_line" | awk '{print $2}')
                log_info "Candidate workspace disk: ${correct_dev} (${disk_size})"

            done < <(lsblk -dn -o NAME,SIZE,TYPE 2>/dev/null)

            if [[ -n "$correct_dev" ]]; then
                # Determine the correct label
                local label=""
                if [[ "$mount_point" == *"bastion-ai"* ]]; then
                    label="bastion-workspace"
                elif [[ "$mount_point" == *"bastion"* ]]; then
                    label="bastion-audit"
                fi

                echo ""
                log_info "Proposed fix:"
                log_info "  OLD: ${dev} ${mount_point} ..."
                log_info "  NEW: LABEL=${label} ${mount_point} ext4 defaults,nosuid,nodev,noexec 0 2"
                echo ""

                if confirm "Apply this fix?"; then
                    # Check if disk needs formatting
                    local fs
                    fs=$(blkid -s TYPE -o value "$correct_dev" 2>/dev/null || true)
                    if [[ -z "$fs" ]]; then
                        if confirm "Disk ${correct_dev} is unformatted. Format as ext4 with label '${label}'?"; then
                            mkfs.ext4 -L "$label" "$correct_dev"
                            log_info "Formatted ${correct_dev}"
                        else
                            log_warn "Skipping — disk must be formatted first"
                            continue
                        fi
                    else
                        # Set label on existing filesystem
                        local existing_label
                        existing_label=$(blkid -s LABEL -o value "$correct_dev" 2>/dev/null || true)
                        if [[ "$existing_label" != "$label" ]]; then
                            e2label "$correct_dev" "$label"
                            log_info "Set label '${label}' on ${correct_dev}"
                        fi
                    fi

                    # Replace fstab entry
                    sed -i "\|${mount_point}|d" /etc/fstab
                    echo "LABEL=${label} ${mount_point} ext4 defaults,nosuid,nodev,noexec 0 2" >> /etc/fstab
                    log_info "fstab entry replaced"
                    ((fixed++))
                fi
            fi
        fi

        # Check 2: Is the device path a raw device that should use a label?
        if [[ "$dev" == /dev/* && "$dev" != LABEL=* && "$dev" != UUID=* ]]; then
            local current_label
            current_label=$(blkid -s LABEL -o value "$dev" 2>/dev/null || true)

            if [[ -n "$current_label" && "$current_label" == bastion* ]]; then
                log_warn "Entry uses device path ${dev} instead of LABEL=${current_label}"
                log_info "Device paths can change between boots — labels are safer"

                if confirm "Replace with LABEL=${current_label}?"; then
                    sed -i "s|^${dev}\s\+${mount_point}|LABEL=${current_label} ${mount_point}|" /etc/fstab
                    log_info "Replaced with label-based mount"
                    ((fixed++))
                fi
            fi
        fi

    done < /etc/fstab

    if [[ $fixed -gt 0 ]]; then
        systemctl daemon-reload
        log_info "Fixed ${fixed} fstab entries. Run 'mount -a' or reboot to apply."
    else
        log_info "No broken Bastion fstab entries found"
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
        jq \
        e2fsprogs

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

        if [[ "$current_version" == v24* ]]; then
            log_info "Node.js 24 already installed (${current_version}), skipping"
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
    log_step "Creating ${BASTION_USER} user and directories"

    if id "$BASTION_USER" &>/dev/null; then
        log_info "User ${BASTION_USER} already exists"
    else
        run useradd -r -m -s /usr/sbin/nologin "$BASTION_USER"
        log_info "Created user: ${BASTION_USER}"
    fi

    run mkdir -p "$APP_DIR"
    run chown "${BASTION_USER}:${BASTION_GROUP}" "$APP_DIR"
    run chmod 750 "$APP_DIR"

    run mkdir -p "$WORKSPACE_DIR"
    run chown -R "${BASTION_USER}:${BASTION_GROUP}" "$WORKSPACE_DIR"
    run chmod 750 "$WORKSPACE_DIR"
}

# ===========================================================================
# Step 4: Firewall (AI client only — relay uses OPNSense only)
# ===========================================================================

setup_firewall() {
    if [[ "$COMPONENT" != "ai-client" ]]; then
        log_info "Skipping local firewall — relay relies on OPNSense rules"
        return
    fi

    log_step "Configuring local nftables firewall"

    local nft_source="${SCRIPT_DIR}/../firewall/ai-client-nftables.conf"

    if [[ -f "$nft_source" ]]; then
        run cp "$nft_source" /etc/nftables.conf
        run systemctl restart nftables
        log_info "nftables firewall applied"
    else
        log_warn "nftables config not found at ${nft_source}"
    fi
}

# ===========================================================================
# Step 5: AppArmor (AI client only)
# ===========================================================================

setup_apparmor() {
    if [[ "$COMPONENT" != "ai-client" ]]; then
        log_info "Skipping AppArmor — relay profile not yet created"
        return
    fi

    log_step "Installing AppArmor profile"

    local profile_source="${SCRIPT_DIR}/../apparmor/bastion-ai-client"

    if [[ -f "$profile_source" ]]; then
        run cp "$profile_source" /etc/apparmor.d/bastion-ai-client
        log_info "Loading in COMPLAIN mode (test first, then enforce)"
        run aa-complain /etc/apparmor.d/bastion-ai-client
        log_warn "Enforce with: sudo aa-enforce /etc/apparmor.d/bastion-ai-client"
    else
        log_warn "AppArmor profile not found at ${profile_source}"
    fi
}

# ===========================================================================
# Step 6: Cgroup resource limits (AI client only)
# ===========================================================================

setup_cgroups() {
    if [[ "$COMPONENT" != "ai-client" ]]; then
        log_info "Skipping cgroup limits — relay is lightweight"
        return
    fi

    log_step "Configuring cgroup resource limits"

    local slice_dir="/etc/systemd/system/bastion-ai-client.service.d"
    run mkdir -p "$slice_dir"

    run bash -c "cat > ${slice_dir}/resources.conf << 'CGROUP_EOF'
[Service]
CPUQuota=${CPU_QUOTA}
MemoryMax=${MEMORY_MAX}
MemoryHigh=${MEMORY_HIGH}
MemorySwapMax=0
IOWeight=${IO_WEIGHT}
TasksMax=${PIDS_MAX}
CGROUP_EOF"

    log_info "Cgroup limits: CPU=${CPU_QUOTA}, Mem=${MEMORY_MAX}, PIDs=${PIDS_MAX}"
}

# ===========================================================================
# Step 7: Systemd service
# ===========================================================================

setup_systemd() {
    log_step "Installing systemd service"

    local service_name="bastion-${COMPONENT}.service"
    # Map component name to service file name
    local service_file
    case "$COMPONENT" in
        ai-client) service_file="bastion-ai-client.service" ;;
        relay)     service_file="bastion-relay.service" ;;
    esac

    local service_source="${SCRIPT_DIR}/../systemd/${service_file}"

    if [[ -f "$service_source" ]]; then
        run cp "$service_source" "/etc/systemd/system/${service_file}"
        run systemctl daemon-reload
        run systemctl enable "$service_file"
        log_info "Service installed and enabled (not started — deploy app first)"
    else
        log_warn "Service file not found at ${service_source}"
    fi
}

# ===========================================================================
# Step 8: Environment template
# ===========================================================================

setup_env_template() {
    log_step "Creating .env template"

    local env_file="${APP_DIR}/.env"

    if [[ -f "$env_file" ]]; then
        log_info ".env file already exists — skipping"
        return
    fi

    if [[ "$COMPONENT" == "ai-client" ]]; then
        run bash -c "cat > ${env_file} << 'ENV_EOF'
# Bastion AI Client — Environment Configuration
# Permissions: chmod 600 | Owner: bastion-ai:bastion-ai

BASTION_RELAY_URL=wss://10.0.30.10:9443
BASTION_AI_CLIENT_ID=ai-client-production
BASTION_AI_DISPLAY_NAME=Claude (Bastion)
BASTION_PROVIDER_ID=anthropic

# ANTHROPIC_API_KEY=sk-ant-...
ENV_EOF"
    else
        run bash -c "cat > ${env_file} << 'ENV_EOF'
# Bastion Relay — Environment Configuration
# Permissions: chmod 600 | Owner: bastion:bastion

BASTION_RELAY_PORT=9443
BASTION_RELAY_HOST=0.0.0.0
BASTION_ADMIN_PORT=9444
BASTION_ADMIN_HOST=127.0.0.1
BASTION_AUDIT_RETENTION_DAYS=365

# BASTION_JWT_SECRET=<generate-with-openssl-rand-base64-32>
ENV_EOF"
    fi

    run chown "${BASTION_USER}:${BASTION_GROUP}" "$env_file"
    run chmod 600 "$env_file"
    log_info "Created .env template at ${env_file}"
}

# ===========================================================================
# Verification
# ===========================================================================

verify_setup() {
    log_step "Running verification checks"

    local passed=0
    local failed=0

    check() {
        local desc="$1"; shift
        if "$@" &>/dev/null; then
            log_info "PASS: ${desc}"; ((passed++))
        else
            log_error "FAIL: ${desc}"; ((failed++))
        fi
    }

    check "User ${BASTION_USER} exists" id "$BASTION_USER"
    check "App directory exists" test -d "$APP_DIR"
    check "Workspace directory exists" test -d "$WORKSPACE_DIR"
    check "Node.js installed" command -v node

    if [[ "$COMPONENT" == "ai-client" ]]; then
        check "Intake directory exists" test -d "${WORKSPACE_DIR}/intake"
        check "Outbound directory exists" test -d "${WORKSPACE_DIR}/outbound"
        check "nftables active" systemctl is-active nftables
    fi

    # Check workspace is mounted on separate disk (if available)
    if [[ -n "$WORKSPACE_DISK" ]] && mountpoint -q "$WORKSPACE_DIR" 2>/dev/null; then
        log_info "PASS: Workspace on separate disk"; ((passed++))

        # Verify mount options
        local opts
        opts=$(findmnt -n -o OPTIONS "$WORKSPACE_DIR")
        if [[ "$opts" == *"nosuid"* && "$opts" == *"nodev"* && "$opts" == *"noexec"* ]]; then
            log_info "PASS: Workspace mounted with nosuid,nodev,noexec"; ((passed++))
        else
            log_error "FAIL: Workspace missing security mount options (has: ${opts})"; ((failed++))
        fi
    fi

    # Check fstab uses labels not device paths
    if grep -q "LABEL=${DISK_LABEL}" /etc/fstab 2>/dev/null; then
        log_info "PASS: fstab uses label-based mount"; ((passed++))
    elif grep -q "$WORKSPACE_DIR" /etc/fstab 2>/dev/null; then
        log_warn "WARN: fstab entry exists but uses device path instead of label"
    fi

    # .env permissions
    if [[ -f "${APP_DIR}/.env" ]]; then
        local perms
        perms=$(stat -c "%a" "${APP_DIR}/.env")
        if [[ "$perms" == "600" ]]; then
            log_info "PASS: .env permissions are 600"; ((passed++))
        else
            log_error "FAIL: .env permissions are ${perms}"; ((failed++))
        fi
    fi

    echo ""
    log_info "Verification: ${passed} passed, ${failed} failed"
    [[ $failed -eq 0 ]]
}

# ===========================================================================
# Network isolation tests
# ===========================================================================

test_network_isolation() {
    log_step "Testing network isolation (${COMPONENT})"

    if [[ "$COMPONENT" == "ai-client" ]]; then
        log_info "Testing relay connection (should SUCCEED)..."
        nc -zv -w3 "$RELAY_IP" "$RELAY_PORT" 2>&1 && log_info "PASS" || log_error "FAIL"

        log_info "Testing external HTTPS (should SUCCEED)..."
        curl -sI --connect-timeout 5 https://api.anthropic.com &>/dev/null && log_info "PASS" || log_error "FAIL"

        log_info "Testing internal lateral movement (should FAIL)..."
        nc -zv -w3 10.0.10.1 22 2>&1 && log_error "FAIL — ISOLATION BREACH" || log_info "PASS — blocked"

        log_info "Testing external DNS (should FAIL)..."
        dig @8.8.8.8 +short +timeout=3 example.com &>/dev/null && log_error "FAIL — exfil risk" || log_info "PASS — blocked"
    else
        log_info "Relay network tests not yet implemented"
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

    echo ""
    echo "  ╔══════════════════════════════════════════╗"
    echo "  ║     Bastion Component Setup Script       ║"
    echo "  ║     Glorktelligence — Naval Fleet        ║"
    echo "  ╚══════════════════════════════════════════╝"
    echo ""

    detect_component
    install_packages
    install_nodejs
    setup_user
    detect_workspace_disk
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
    log_step "Setup complete for: ${COMPONENT}"
    echo ""
    log_info "Next steps:"
    log_info "  1. Deploy Bastion ${COMPONENT} to ${APP_DIR}"
    log_info "  2. Edit ${APP_DIR}/.env with credentials"

    if [[ "$COMPONENT" == "ai-client" ]]; then
        log_info "  3. Test AppArmor, then enforce:"
        log_info "     sudo aa-enforce /etc/apparmor.d/bastion-ai-client"
        log_info "  4. Start: sudo systemctl start bastion-ai-client"
        log_info "  5. Test isolation: sudo bash setup-bastion.sh --test-network"
    else
        log_info "  3. Generate JWT secret: openssl rand -base64 32"
        log_info "  4. Configure TLS certificates"
        log_info "  5. Start: sudo systemctl start bastion-relay"
    fi
}

# Handle special modes
case "${1:-}" in
    --test-network)
        check_root
        detect_component
        test_network_isolation
        exit $?
        ;;
    --fix-fstab)
        check_root
        fix_fstab
        exit $?
        ;;
esac

main
