# Live Collab for VS Code

Real-time multiplayer code collaboration secured by GitHub repository permissions and local WebSocket synchronization.

---

## Features

1. **GitHub Collaborator Authorization**:
   - Only authorized collaborators on the host's GitHub repository can connect to the collaboration session.
   - Host and guests authenticate using GitHub OAuth via VS Code's native authentication provider (`vscode.authentication.getSession('github', ['repo'])`).
   - Automatically verifies permissions (`admin`, `write`, `maintain`) via the GitHub REST API (`/repos/:owner/:repo/collaborators/:username/permission`).

2. **Real-Time Code Synchronization**:
   - Simultaneous, sub-second typing synchronization.
   - Conflict-free edit resolution using character range diffs.
   - Non-recursive edit isolation: host and guests apply incoming edits without infinite feedback loops.
   - Optional automatic disk persistence on the host machine.

3. **Presence & Multi-Cursor Carets**:
   - Multi-user cursor indicators showing where each teammate is currently editing.
   - Usernames and avatar-colored caret flags above remote cursors.
   - Selections highlighted in each collaborator's designated color.

4. **Dedicated Workbench UI**:
   - **Activity Bar View**: "Live Collab" view container with **Active Collaborators** and **Session Details** panels.
   - **Status Bar Integration**: Clickable status indicator showing current session state (Hosting, Connected, or Idle).

---

## Available Commands

| Command | Title | Description |
| :--- | :--- | :--- |
| `liveCollab.startSession` | **Start Collaboration Session** | Starts local server, verifies repo permissions, and generates shareable session link. |
| `liveCollab.joinSession` | **Join Collaboration Session** | Prompts for session URL and repo, authenticates with GitHub, and connects. |
| `liveCollab.copyInviteLink` | **Copy Collaboration Invite Link** | Copies the session connection details to clipboard. |
| `liveCollab.stopSession` | **End Collaboration Session** | Disconnects all connected peers and stops the local server. |

---

## Configuration Settings

- `liveCollab.defaultPort`: Default local port for the WebSocket server (default: `8989`).
- `liveCollab.autoSaveRemoteChanges`: Automatically save incoming edits to disk on the host machine (default: `true`).
