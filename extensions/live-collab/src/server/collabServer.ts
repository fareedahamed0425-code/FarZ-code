/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import { CollabMessage, CollabUser, SessionInfo } from '../types';
import { GitHubCollabManager } from '../auth/githubCollab';

interface ConnectedPeer {
	readonly ws: WebSocket;
	user?: CollabUser;
	isAuthenticated: boolean;
}

export class CollabServer {
	private server?: http.Server;
	private wss?: WebSocketServer;
	private readonly peers = new Map<WebSocket, ConnectedPeer>();
	private sessionInfo?: SessionInfo;
	private readonly _onDidPeerJoin = new vscode.EventEmitter<CollabUser>();
	public readonly onDidPeerJoin = this._onDidPeerJoin.event;
	private readonly _onDidPeerLeave = new vscode.EventEmitter<string>();
	public readonly onDidPeerLeave = this._onDidPeerLeave.event;
	private readonly _onDidReceiveTextChange = new vscode.EventEmitter<{ uri: string; changes: any[]; senderId: string }>();
	public readonly onDidReceiveTextChange = this._onDidReceiveTextChange.event;

	constructor(
		private readonly hostUser: CollabUser,
		private readonly repoOwner: string,
		private readonly repoName: string,
		private readonly port: number = 8989
	) {}

	public async start(): Promise<SessionInfo> {
		return new Promise((resolve, reject) => {
			this.server = http.createServer((req, res) => {
				if (req.url === '/health') {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ status: 'ok', repo: `${this.repoOwner}/${this.repoName}` }));
					return;
				}
				res.writeHead(404);
				res.end();
			});

			this.wss = new WebSocketServer({ server: this.server });

			this.wss.on('connection', (ws: WebSocket) => {
				const peer: ConnectedPeer = { ws, isAuthenticated: false };
				this.peers.set(ws, peer);

				ws.on('message', async (data: Buffer | string) => {
					try {
						const msg = JSON.parse(data.toString()) as CollabMessage;
						await this.handleMessage(ws, peer, msg);
					} catch (e) {
						console.error('Failed to parse message from peer:', e);
					}
				});

				ws.on('close', () => {
					this.handleDisconnect(ws);
				});

				ws.on('error', err => {
					console.error('WebSocket peer error:', err);
					this.handleDisconnect(ws);
				});
			});

			this.server.listen(this.port, () => {
				const sessionId = `${this.repoOwner}-${this.repoName}-${Date.now().toString(36)}`;
				const url = `ws://localhost:${this.port}`;
				this.sessionInfo = {
					sessionId,
					hostUsername: this.hostUser.username,
					repoOwner: this.repoOwner,
					repoName: this.repoName,
					port: this.port,
					url,
					isHost: true,
				};
				resolve(this.sessionInfo);
			});

			this.server.on('error', err => {
				reject(err);
			});
		});
	}

	private async handleMessage(ws: WebSocket, peer: ConnectedPeer, msg: CollabMessage): Promise<void> {
		switch (msg.type) {
			case 'auth_request': {
				// Verify repository matching
				if (msg.repoOwner.toLowerCase() !== this.repoOwner.toLowerCase() ||
					msg.repoName.toLowerCase() !== this.repoName.toLowerCase()) {
					this.send(ws, {
						type: 'auth_response',
						success: false,
						error: `Repository mismatch. Session is for ${this.repoOwner}/${this.repoName}`,
					});
					ws.close();
					return;
				}

				// Check GitHub collaborator access
				const verification = await GitHubCollabManager.verifyCollaborator(
					msg.token,
					this.repoOwner,
					this.repoName,
					msg.username
				);

				if (!verification.isCollaborator) {
					this.send(ws, {
						type: 'auth_response',
						success: false,
						error: verification.error || 'Access denied: You are not an authorized collaborator on this repository.',
					});
					ws.close();
					return;
				}

				// Successfully authenticated
				const user: CollabUser = {
					id: msg.username,
					username: msg.username,
					displayName: msg.username,
					avatarUrl: `https://github.com/${msg.username}.png`,
					color: GitHubCollabManager.getColorForUser(msg.username),
				};

				peer.isAuthenticated = true;
				peer.user = user;

				// Return current active peers (including host)
				const currentPeers: CollabUser[] = [this.hostUser];
				for (const p of this.peers.values()) {
					if (p.isAuthenticated && p.user && p.user.id !== user.id) {
						currentPeers.push(p.user);
					}
				}

				this.send(ws, {
					type: 'auth_response',
					success: true,
					user,
					peers: currentPeers,
				});

				// Notify other peers
				this.broadcast({ type: 'peer_joined', user }, ws);
				this._onDidPeerJoin.fire(user);
				break;
			}

			case 'text_change': {
				if (!peer.isAuthenticated) {
					return;
				}
				// Relay edit to host and all other peers
				this._onDidReceiveTextChange.fire({
					uri: msg.uri,
					changes: msg.changes,
					senderId: msg.senderId,
				});
				this.broadcast(msg, ws);
				break;
			}

			case 'cursor_update': {
				if (!peer.isAuthenticated) {
					return;
				}
				// Broadcast cursor position to all other peers
				this.broadcast(msg, ws);
				break;
			}

			case 'file_request': {
				if (!peer.isAuthenticated) {
					return;
				}
				// Load file content from host workspace
				try {
					const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
					if (workspaceUri) {
						const fileUri = vscode.Uri.joinPath(workspaceUri, msg.uri);
						const fileData = await vscode.workspace.fs.readFile(fileUri);
						this.send(ws, {
							type: 'file_response',
							uri: msg.uri,
							content: Buffer.from(fileData).toString('utf8'),
						});
					}
				} catch (e) {
					console.error(`Failed to read file ${msg.uri}:`, e);
				}
				break;
			}
		}
	}

	public broadcast(msg: CollabMessage, excludeWs?: WebSocket): void {
		const payload = JSON.stringify(msg);
		for (const [socket, peer] of this.peers.entries()) {
			if (socket !== excludeWs && peer.isAuthenticated && socket.readyState === WebSocket.OPEN) {
				socket.send(payload);
			}
		}
	}

	public send(ws: WebSocket, msg: CollabMessage): void {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(msg));
		}
	}

	private handleDisconnect(ws: WebSocket): void {
		const peer = this.peers.get(ws);
		if (peer && peer.user) {
			this._onDidPeerLeave.fire(peer.user.id);
			this.broadcast({ type: 'peer_left', userId: peer.user.id }, ws);
		}
		this.peers.delete(ws);
	}

	public getConnectedPeers(): CollabUser[] {
		const users: CollabUser[] = [];
		for (const peer of this.peers.values()) {
			if (peer.isAuthenticated && peer.user) {
				users.push(peer.user);
			}
		}
		return users;
	}

	public stop(): void {
		for (const ws of this.peers.keys()) {
			ws.close();
		}
		this.peers.clear();
		this.wss?.close();
		this.server?.close();
	}
}
