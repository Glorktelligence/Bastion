# Deployment

## systemd Service Templates

Reference service files for systemd — copy to `/etc/systemd/system/` or use `bastion migrate` to install automatically.

- `systemd/bastion-relay.service` — Relay server
- `systemd/bastion-admin-ui.service` — Admin panel (bound to 127.0.0.1 only)
- `systemd/bastion-ai-client.service` — AI client

## CLI Management

See `scripts/bastion-cli.sh` — install to `/usr/local/bin/bastion`:

```bash
sudo cp scripts/bastion-cli.sh /usr/local/bin/bastion
sudo chmod +x /usr/local/bin/bastion
```

## Migration

Run `sudo bastion migrate --vm relay|ai` for one-time migration to single-user architecture.
