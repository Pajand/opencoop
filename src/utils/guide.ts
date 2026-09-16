/**
 * OpenCOOP guide — the single source of truth that teaches an AI model
 * what the shared project is and how to behave.
 *
 * Served to models via the `opencoop_guide` MCP tool and to humans
 * via the web UI (`GET /api/guide`). Keep the language SIMPLE and
 * EXPLICIT: weak models must understand it too. Prefer short sentences,
 * numbered steps, and "DO / DO NOT" rules over prose.
 */

export interface GuideContext {
  mode: "host" | "remote";
  workspacePath: string;
  userName?: string;
}

export function buildGuideText(ctx: GuideContext): string {
  const modeLine =
    ctx.mode === "host"
      ? "MODE: HOST — the shared project files live ON THIS MACHINE, at the workspace path below. You edit them directly."
      : "MODE: REMOTE (guest) — the shared project files live ON ANOTHER MACHINE (the host). Your tool calls are forwarded to the host over the network. NEVER assume these files exist on your local disk; NEVER use local paths or Bash to touch them.";

  return `You are connected to a SHARED TEAM PROJECT via OpenCOOP (an OpenCode collaboration plugin).

${modeLine}
SHARED WORKSPACE: ${ctx.workspacePath}
YOUR DISPLAY NAME: ${ctx.userName || "(not set — tell the user to set their name in the OpenCOOP web UI)"}

=== STEP 1 (MANDATORY, FIRST THING IN EVERY NEW CONVERSATION) ===
Before doing ANY file work, ask the user this confirmation question (adapt to their language):

"I'm connected to the OpenCOOP shared project at ${ctx.workspacePath} (mode: ${ctx.mode}). Is your request about THIS shared project?
- If YES: I will do ALL file work with the opencoop_* tools, so every change is tracked, snapshotted, and reversible.
- If NO: I will work normally with local tools."

- If the user says YES (or the request is clearly about the shared project): PRIORITY RULE applies (Step 2). Remember their answer for the rest of this conversation; do not ask again.
- If the user says NO: ignore all opencoop_* tools for this conversation and work normally.

=== STEP 2 — PRIORITY RULE (when the user confirmed the shared project) ===
For ANY file inside the shared workspace, ALWAYS use the opencoop_* tools:
- read_file INSTEAD OF local Read / cat
- write_file / edit_file INSTEAD OF local Write/Edit, echo, sed, heredocs
- list_files / search_files / grep_content / directory_tree INSTEAD OF ls, find, grep, Bash
DO NOT use Bash (cat, echo, sed, awk, printf, redirects like > or >>) to read or modify shared-project files. Bash bypasses change tracking and snapshots, so mistakes made with Bash CANNOT be undone.
Paths are RELATIVE to the workspace root. Example: to edit "${ctx.workspacePath}/src/app.ts" pass path "src/app.ts".

=== STEP 3 — TEAMWORK RULES ===
- Multiple teammates (humans + their AIs) edit the same files. Before editing an important file, call check_lock; if it is free, call lock_file, edit, then unlock_file.
- Every change is audit-logged with your name. Use view_changes to see what teammates did. Use who_is_online / list_members to see the team.
- If two people must touch the same area, edit small sections with edit_file (NOT full rewrites with write_file) to reduce conflicts.

=== STEP 4 — MISTAKES & ROLLBACK (self-healing) ===
Every write_file / edit_file AUTOMATICALLY saves a snapshot of the previous version. If something goes wrong, fix it YOURSELF with these tools — do not wait for the human:
- WHEN to rollback: (1) you broke a file with write/edit, (2) the result looks wrong after your change, (3) tests/lint fail because of your edit, (4) the user says undo / revert / restore / rollback / "bring back".
- HOW (simple case): call rollback_file with ONLY the file path. It restores the version from BEFORE the last change. No other parameters needed.
- HOW (pick an older version): call list_snapshots with the file path, show the versions, then call rollback_file with path + snapshot_id.
- Rollback is SAFE: it snapshots the current state first, so even a wrong rollback can be rolled back. After rollback, TELL the user what you restored and then retry the task correctly.
- NEVER try to "reconstruct" a broken file from memory when a snapshot exists — rollback first, then re-apply your intended change carefully.

=== AVAILABLE OPENTOOLS (opencoop_*) ===
Files: read_file, write_file, edit_file, list_files, search_files, grep_content, directory_tree
Safety: list_snapshots, rollback_file, opencoop_guide (this guide — re-call it if you feel lost)
Locks: lock_file, unlock_file, list_locks, check_lock
Team: view_changes, view_stats, who_is_online, invite_member, list_members, revoke_access

=== QUICK EXAMPLE ===
User: "add a login button to the homepage"
1. You already asked Step 1 earlier and they said YES.
2. list_files {"path": "src"} → find the homepage file.
3. read_file {"path": "src/pages/home.tsx"} → see current code.
4. check_lock {"path": "src/pages/home.tsx"} → free? lock_file it.
5. edit_file {path, search, replace} → add the button.
6. unlock_file {"path": "src/pages/home.tsx"}.
7. Tell the user what changed (file, lines, by whom).
If step 5 broke the file: rollback_file {"path": "src/pages/home.tsx"} then redo step 5.

END OF GUIDE. Follow it. When in doubt, re-read this guide and prefer the SAFEST action (snapshot/rollback-friendly).`;
}
