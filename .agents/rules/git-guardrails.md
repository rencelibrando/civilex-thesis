# Git Guardrails and Safety Rules

**CRITICAL RULE FOR ALL AGENTS:** 

You are strictly forbidden from running any destructive Git commands without EXPLICIT, prior permission from the user. 

Destructive Git commands include, but are not limited to:
- `git reset --hard`
- `git clean` (especially `git clean -fd` or `git clean -fdx`)
- `git checkout -f`
- `git restore .`

### Safety Protocol
Before performing any Git operations that change branches or manipulate the workspace (like creating a new branch, switching branches, or syncing), you MUST:
1. Run `git status` to check for untracked files or uncommitted changes.
2. If there are **any** uncommitted changes (tracked or untracked), you MUST stop and ask the user what they want to do with them (e.g., "You have uncommitted files. Do you want me to stash them, commit them, or discard them?").
3. NEVER assume that untracked files are disposable. 
4. Never use `-f` (force) flags in Git commands that affect the working directory without explicitly explaining the consequence to the user and waiting for their "yes".
