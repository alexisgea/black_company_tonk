# Agent instructions

## Finishing a task: bump the version and commit

When you have finished making changes that the user asked for, do the following as the last step, without waiting to be asked:

1. Run the checks: `npm run lint`, `npm run format:check` and `npm test`. Fix anything you broke.
2. Bump the app version (single source of truth: `package.json`, which the server and client both read). Use SemVer and update `package-lock.json` too:
   - `npm version patch --no-git-tag-version` for fixes, tweaks and small changes
   - `npm version minor --no-git-tag-version` for new features or visible behaviour changes
   - `npm version major --no-git-tag-version` only if the user asks for it
   - Skip the bump for docs-only, comment-only or tooling-only changes.
3. When you bump the version, add a matching entry at the top of `CHANGELOG` in `public/js/changelog-data.js` (shown in the Changelog dialog on the main page). Use the new version, today's date (`YYYY-MM-DD`) and one or more short, plain-language lines describing what players or the host will notice. `npm test` fails if the newest entry does not match the `package.json` version. No bump means no entry.
4. Commit all of your changes (including the version files and the changelog) in a single commit. Stage only files you changed; do not include unrelated pre-existing edits.
   - Use a short imperative subject describing the change, then mention the version when bumped, e.g. `Move kick controls to the side player list and bump version to 0.2.0`
   - Do not push, tag or amend unless the user asks.

Do not put the commit hash in the version number; the version identifies a release and the commit message links it back to the change.

To disable this behaviour, tell the agent "don't bump or commit" for that task, or remove this section.
