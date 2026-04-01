# Git Workflow Skill

When the user's message involves git operations:

## Commit Standards
- Use Conventional Commits: `type(scope): description`
- Types: feat, fix, security, refactor, docs, test, chore
- Include co-author attribution when applicable
- Keep commit messages concise but descriptive

## Branch Management
- Feature branches from main
- Never force-push to main/master without explicit approval
- Check for uncommitted changes before destructive operations

## Pull Requests
- Keep PRs focused on a single concern
- Include a summary and test plan
- Reference related issues

## Safety Checks
- Review diffs before committing
- Run tests before pushing
- Never commit secrets, credentials, or .env files
