/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CollabServer } from './server/collabServer';
import { CollabClient } from './client/collabClient';
import { EditorBindingManager } from './client/editorBinding';
import { GitHubCollabManager } from './auth/githubCollab';
import { PeersTreeDataProvider, SessionTreeDataProvider, CollabStatusBarManager } from './ui/collabView';
import { SessionInfo } from './types';

let currentServer: CollabServer | undefined;
let currentClient: CollabClient | undefined;
let activeSession: SessionInfo | undefined;

export function activate(context: vscode.ExtensionContext) {
	const editorBinding = new EditorBindingManager();
	context.subscriptions.push(editorBinding);

	const peersTreeProvider = new PeersTreeDataProvider();
	const sessionTreeProvider = new SessionTreeDataProvider();
	const statusBarManager = new CollabStatusBarManager();
	context.subscriptions.push(statusBarManager);

	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('liveCollab.peersView', peersTreeProvider),
		vscode.window.registerTreeDataProvider('liveCollab.sessionView', sessionTreeProvider)
	);

	// Command: Start Session (Host)
	const startSessionCmd = vscode.commands.registerCommand('liveCollab.startSession', async () => {
		if (activeSession) {
			vscode.window.showInformationMessage(`Session already active on ${activeSession.url}`);
			return;
		}

		// 1. Authenticate with GitHub
		const session = await GitHubCollabManager.getSession(true);
		if (!session) {
			vscode.window.showErrorMessage('GitHub authentication is required to start a collaboration session.');
			return;
		}

		const hostUser = GitHubCollabManager.createCollabUser(session);

		// 2. Discover GitHub repository details
		let repoDetails = await GitHubCollabManager.getWorkspaceRepoDetails();
		if (!repoDetails) {
			const repoInput = await vscode.window.showInputBox({
				prompt: 'Enter GitHub Repository (owner/repo)',
				placeHolder: 'e.g. microsoft/vscode',
				validateInput: val => {
					return val.includes('/') ? null : 'Please specify in owner/repo format';
				},
			});
			if (!repoInput) {
				return;
			}
			const [owner, repo] = repoInput.split('/');
			repoDetails = { owner: owner.trim(), repo: repo.trim() };
		}

		// 3. Start local WebSocket server
		const config = vscode.workspace.getConfiguration('liveCollab');
		const port = config.get<number>('defaultPort', 8989);

		try {
			currentServer = new CollabServer(hostUser, repoDetails.owner, repoDetails.repo, port);
			activeSession = await currentServer.start();

			// Listen to edits from peers to update host editor
			currentServer.onDidReceiveTextChange(async event => {
				await editorBinding.applyRemoteChanges(event.uri, event.changes);
			});

			// Broadcast host's local changes to all peers
			editorBinding.onDidLocalChange(event => {
				currentServer?.broadcast({
					type: 'text_change',
					uri: event.uri,
					version: 1,
					changes: event.changes,
					senderId: hostUser.id,
				});
			});

			// Broadcast host's cursor updates
			editorBinding.onDidLocalCursorMove(event => {
				currentServer?.broadcast({
					type: 'cursor_update',
					uri: event.uri,
					senderId: hostUser.id,
					selection: event.selection,
				});
			});

			// Update peers list on join/leave
			currentServer.onDidPeerJoin(peer => {
				vscode.window.showInformationMessage(`Collaborator @${peer.username} joined the session.`);
				updatePeersView();
			});

			currentServer.onDidPeerLeave(userId => {
				editorBinding.removePeer(userId);
				vscode.window.showInformationMessage(`Collaborator left the session.`);
				updatePeersView();
			});

			function updatePeersView() {
				const allPeers = [hostUser, ...(currentServer?.getConnectedPeers() || [])];
				peersTreeProvider.updatePeers(allPeers);
				statusBarManager.setHosting(allPeers.length - 1, `${repoDetails!.owner}/${repoDetails!.repo}`);
			}

			sessionTreeProvider.updateSession(activeSession);
			updatePeersView();

			const copyAction = 'Copy Invite Link';
			vscode.window
				.showInformationMessage(
					`Collaboration server started on port ${port} for ${repoDetails.owner}/${repoDetails.repo}!`,
					copyAction
				)
				.then(selection => {
					if (selection === copyAction) {
						vscode.commands.executeCommand('liveCollab.copyInviteLink');
					}
				});
		} catch (err: any) {
			vscode.window.showErrorMessage(`Failed to start collaboration server: ${err.message}`);
		}
	});

	// Command: Join Session (Guest)
	const joinSessionCmd = vscode.commands.registerCommand('liveCollab.joinSession', async () => {
		if (activeSession) {
			vscode.window.showInformationMessage('You are already connected to a collaboration session.');
			return;
		}

		// 1. Authenticate with GitHub
		const session = await GitHubCollabManager.getSession(true);
		if (!session) {
			vscode.window.showErrorMessage('GitHub authentication is required to join a collaboration session.');
			return;
		}

		const currentUser = GitHubCollabManager.createCollabUser(session);

		// 2. Input session URL
		const serverUrl = await vscode.window.showInputBox({
			prompt: 'Enter Host Collaboration URL',
			placeHolder: 'ws://localhost:8989 or tunnel URL',
			value: 'ws://localhost:8989',
		});
		if (!serverUrl) {
			return;
		}

		// 3. Input repository details
		let repoDetails = await GitHubCollabManager.getWorkspaceRepoDetails();
		if (!repoDetails) {
			const repoInput = await vscode.window.showInputBox({
				prompt: 'Enter GitHub Repository for this project (owner/repo)',
				placeHolder: 'e.g. microsoft/vscode',
			});
			if (!repoInput) {
				return;
			}
			const [owner, repo] = repoInput.split('/');
			repoDetails = { owner: owner.trim(), repo: repo.trim() };
		}

		try {
			currentClient = new CollabClient(editorBinding, currentUser);
			const peers = await currentClient.connect(
				serverUrl,
				session.accessToken,
				repoDetails.owner,
				repoDetails.repo
			);

			activeSession = {
				sessionId: `guest-${Date.now().toString(36)}`,
				hostUsername: repoDetails.owner,
				repoOwner: repoDetails.owner,
				repoName: repoDetails.repo,
				port: 8989,
				url: serverUrl,
				isHost: false,
			};

			peersTreeProvider.updatePeers(peers);
			sessionTreeProvider.updateSession(activeSession);
			statusBarManager.setConnected(repoDetails.owner);

			currentClient.onDidPeerJoin(() => {
				peersTreeProvider.updatePeers(currentClient?.getPeers() || []);
			});

			currentClient.onDidPeerLeave(() => {
				peersTreeProvider.updatePeers(currentClient?.getPeers() || []);
			});

			currentClient.onDidDisconnect(() => {
				vscode.window.showWarningMessage('Disconnected from collaboration session.');
				stopSession();
			});

			vscode.window.showInformationMessage(`Successfully connected to collaboration session on ${serverUrl}!`);
		} catch (err: any) {
			vscode.window.showErrorMessage(`Failed to join session: ${err.message}`);
		}
	});

	// Command: Copy Invite Link
	const copyInviteLinkCmd = vscode.commands.registerCommand('liveCollab.copyInviteLink', async () => {
		if (!activeSession) {
			vscode.window.showInformationMessage('No active session. Start a session first.');
			return;
		}

		const inviteInfo = `${activeSession.url} (${activeSession.repoOwner}/${activeSession.repoName})`;
		await vscode.env.clipboard.writeText(inviteInfo);
		vscode.window.showInformationMessage(`Copied session link to clipboard: ${inviteInfo}`);
	});

	// Command: Stop Session
	const stopSessionCmd = vscode.commands.registerCommand('liveCollab.stopSession', () => {
		stopSession();
		vscode.window.showInformationMessage('Collaboration session ended.');
	});

	function stopSession() {
		if (currentServer) {
			currentServer.stop();
			currentServer = undefined;
		}
		if (currentClient) {
			currentClient.dispose();
			currentClient = undefined;
		}
		activeSession = undefined;
		peersTreeProvider.updatePeers([]);
		sessionTreeProvider.updateSession(undefined);
		statusBarManager.setIdle();
	}

	context.subscriptions.push(
		startSessionCmd,
		joinSessionCmd,
		copyInviteLinkCmd,
		stopSessionCmd
	);
}

export function deactivate() {
	if (currentServer) {
		currentServer.stop();
	}
	if (currentClient) {
		currentClient.dispose();
	}
}
