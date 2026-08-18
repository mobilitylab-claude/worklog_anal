<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:win-client-sync-rule -->
# Windows Client Sync Rule
Whenever you make ANY changes to the `win-client` directory in this workspace (`Z:\workspace\worklog_anal\win-client`), you MUST immediately run the following `robocopy` command using the `run_command` tool to automatically copy the updated files to the local `D:\works\win-client` directory:
`robocopy Z:\workspace\worklog_anal\win-client D:\works\win-client /mir /xd node_modules target src-tauri\target .next`
This is mandatory so the user can test the Tauri app locally without network drive errors. Do NOT forget to sync after editing `win-client` files.
<!-- END:win-client-sync-rule -->

<!-- BEGIN:linux-build-environment-rule -->
# Linux Build Environment Rule
The user primarily performs `npm install` and `npm run build` in a Linux environment (specifically on a Samba mounted drive `/mnt/Data1T/samba/...` which may have `noexec` permission limitations). When proposing commands or troubleshooting build errors, keep this environment in mind (e.g., recommend `--ignore-scripts` for npm install if permission issues occur).
<!-- END:linux-build-environment-rule -->

