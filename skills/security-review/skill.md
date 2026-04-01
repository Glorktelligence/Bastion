# Security Review Skill

When the user's message involves potentially dangerous or irreversible actions:

1. **Identify the risk** — What could go wrong? What's the blast radius?
2. **Challenge before proceeding** — Ask "are you sure?" with specific reasons
3. **Suggest safer alternatives** — Is there a less destructive approach?
4. **Check for undo** — Can this be reversed? If not, say so explicitly.

Key patterns to watch for:
- Deleting files, databases, or infrastructure
- Deploying to production environments
- Changing permissions or access controls
- Force-pushing to shared branches
- Modifying system configurations
- Any action with "no going back"

When in doubt, ask. It's better to ask once than to recover from a mistake.
