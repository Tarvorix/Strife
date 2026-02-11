## Core Behavior

1. **Listen to all instructions** - Read the user's request carefully. Understand exactly what they are asking before doing anything.
2. **Only do what is asked** - Do NOT modify code that wasn't explicitly requested. Do NOT "fix" things that aren't broken. Do NOT make improvements or refactors unless specifically asked.
3. **Explain before making changes** - Before editing any file, explain what you plan to change and why. Wait for confirmation if the change is significant.
4. **Double check all work** - After making changes, verify they are correct. Re-read the original request to confirm you addressed what was actually asked, not what you assumed.
5. **Complete all tasks fully** - Do not simplify, Do not use placeholders, Complete all tasks fully and completely.
6. **When commiting and pushing to Github** - Commiter and Author should be Tarvorix...no mention of Claude anywhere in any commit message.
7. **No Placeholder Code** - Absolutely no placeholder code everything must be implemented fully
8. **No Simplification** - Absolutely no simplification of code everything must be implemented fully

## Prohibited Actions

- NEVER change working code without explicit permission
- NEVER assume something is broken without evidence
- NEVER make "while I'm here" improvements
- NEVER claim to fix something you weren't asked to fix
- NEVER touch deployment code if asked to fix movement code
- NEVER touch movement code if asked to fix deployment code
- NEVER add flags, options, or parameters that weren't in the original command
- NEVER start coding tasks without explicit user request
- NEVER create todo lists for tasks the user didn't ask for
- NEVER remove functionality from code - if adding features, preserve ALL existing behavior (e.g., gzip flush for live counts)
- Never simplify or use placeholder code
- NEVER ignore or fail to follow users explicit instruction...when they say finish...FINISH


## File Deletion Rules

- NEVER delete any file or directory without explicit user confirmation
- Before ANY rm, rm -rf, or delete operation: list exactly what will be deleted and ask "Should I delete these? (yes/no)"
- Wait for explicit "yes" before proceeding
- No exceptions

## Before Any Code Change

Ask yourself:
1. Did the user explicitly ask for this change?
2. Is this code actually broken, or am I assuming?
3. Will this change affect other working functionality?
4. Have I explained what I'm about to do?

## If Uncertain

ASK. Do not guess. Do not assume. Ask the user to clarify.

## Git Author Configuration

All commits must use Tarvorix as author and committer. No mention of "Claude" anywhere in git commits.

Author name: Tarvorix
Committer name: Tarvorix
Never use "Claude" or any variation in commit author, committer, or commit messages or email
Configure git before committing:
git config user.name "Tarvorix"
git config user.email "Tarvorix@users.noreply.github.com"

## Project Overview
- Develop Tactical Game "Strife" (X-COM style) using Babylon.js 8.x with TypeScript and Vite