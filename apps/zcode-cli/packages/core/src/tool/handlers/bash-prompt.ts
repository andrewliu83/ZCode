export function createBashProviderDescription(input: {
  defaultTimeoutMs: number;
  embeddedSearchEnabled?: boolean;
  maxTimeoutMs: number;
}): string {
  const avoidCommands = input.embeddedSearchEnabled
    ? "`cat`, `head`, `tail`, `sed`, `awk`, or `echo`"
    : "`find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo`";

  return [
    "Executes a bash command and returns its output.",
    "",
    "- Working directory persists between calls, but prefer absolute paths — `cd` in a compound command can trigger a permission prompt. Shell state (env vars, functions) does not persist; the shell is initialized from the user's profile.",
    `- IMPORTANT: Avoid using this tool to run ${avoidCommands} commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user.`,
    "  - Read files: Use Read (NOT cat/head/tail)",
    "  - Edit files: Use Edit (NOT sed/awk)",
    "  - Write files: Use Write (NOT echo >/cat <<EOF)",
    "  - Communication: Output text directly (NOT echo/printf)",
    `- \`timeout\` is in milliseconds: default ${input.defaultTimeoutMs}, max ${input.maxTimeoutMs}.`,
    "- `run_in_background` runs the command detached: it keeps running across turns and re-invokes you when it exits. No `&` needed.",
    "- If your command will create new directories or files, first run `ls` to verify the parent directory exists and is the correct location.",
    "- Always quote file paths that contain spaces with double quotes.",
    "- Avoid unnecessary `sleep` commands: do not sleep between commands that can run immediately, and do not poll a background task — you are notified when it finishes.",
    "- When running `find`, search from `.` (or a specific path), not `/` — scanning the full filesystem can exhaust system resources on large trees.",
    "",
    "# Git",
    "- Interactive flags (`-i`, e.g. `git rebase -i`, `git add -i`) are not supported in this environment.",
    "- Use the `gh` CLI for GitHub operations (PRs, issues, API).",
    "- Commit or push only when the user asks. If on the default branch, branch first.",
    "- NEVER run destructive git commands (push --force, reset --hard, checkout ., restore ., clean -f, branch -D) unless the user explicitly requests them. Never force push to main/master.",
    "- NEVER skip hooks (--no-verify, --no-gpg-sign) unless the user explicitly requests it. If a hook fails, investigate and fix the underlying issue.",
    "- Always create NEW commits rather than amending, unless the user explicitly requests an amend. When a pre-commit hook fails the commit did NOT happen, so --amend would modify the previous commit.",
    "- When staging files, prefer adding specific files by name rather than `git add -A` or `git add .`, which can accidentally include secrets or large binaries.",
  ].join("\n");
}
