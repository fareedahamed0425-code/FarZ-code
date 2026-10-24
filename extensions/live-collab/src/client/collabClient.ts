/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { WebSocket } from 'ws';
import { CollabMessage, CollabUser, CursorPosition, TextChangeDelta } from '../types';
import { EditorBindingManager } from './editorBinding';

export class CollabClient implements vscode.Disposable {
	private ws?: WebSocket;
	private readonly peers = new Map<string, CollabUser>();
	private readonly disposables: vscode.Disposable[] = [];

	private readonly _onDidPeerJoin = new vscode.EventEmitter<CollabUser>();
	public readonly onDidPeerJoin = this._onDidPeerJoin.event;

	private readonly _onDidPeerLeave = new vscode.EventEmitter<string>();
	public readonly onDidPeerLeave = this._onDidPeerLeave.event;

	private readonly _onDidDisconnect = new vscode.EventEmitter<void>();
	public readonly onDidDisconnect = this._onDidDisconnect.event;

	constructor(
		private readonly editorBinding: EditorBindingManager,
		private readonly currentUser: CollabUser
	) {
		// Forward local document changes over WebSocket
		this.disposables.push(
			this.editorBinding.onDidLocalChange(event => {
				this.send({
					type: 'text_change',
					uri: event.uri,
					version: 1,
					changes: event.changes,
					senderId: this.currentUser.id,
				});
			})
		);

		// Forward local cursor movements over WebSocket
		this.disposables.push(
			this.editorBinding.onDidLocalCursorMove(event => {
				this.send({
					type: 'cursor_update',
					uri: event.uri,
					senderId: this.currentUser.id,
					selection: event.selection,
				});
			})
		);
	}

	public async connect(
		serverUrl: string,
		githubToken: string,
		repoOwner: string,
		repoName: string
	): Promise<CollabUser[]> {
		return new Promise((resolve, reject) => {
			try {
				this.ws = new WebSocket(serverUrl);
			} catch (e) {
				return reject(e);
			}

			let authenticated = false;

			this.ws.on('open', () => {
				// Send authentication handshake
				this.send({
					type: 'auth_request',
					token: githubToken,
					username: this.currentUser.username,
					repoOwner,
					repoName,
				});
			});

			this.ws.on('message', async (data: Buffer | string) => {
				try {
					const msg = JSON.parse(data.toString()) as CollabMessage;

					if (msg.type === 'auth_response') {
						if (msg.success) {
							authenticated = true;
							if (msg.peers) {
								for (const peer of msg.peers) {
									this.peers.set(peer.id, peer);
								}
							}
							resolve(Array.from(this.peers.values()));
						} else {
							reject(new Error(msg.error || 'Authentication rejected by collaboration host.'));
							this.ws?.close();
						}
						return;
					}

					if (!authenticated) {
						return;
					}

					this.handleMessage(msg);
				} catch (e) {
					console.error('Error handling collab message:', e);
				}
			});

			this.ws.on('close', () => {
				this._onDidDisconnect.fire();
			});

			this.ws.on('error', err => {
				if (!authenticated) {
					reject(err);
				}
				console.error('WebSocket client error:', err);
			});
		});
	}

	private handleMessage(msg: CollabMessage): void {
		switch (msg.type) {
			case 'peer_joined': {
				this.peers.set(msg.user.id, msg.user);
				this._onDidPeerJoin.fire(msg.user);
				break;
			}

			case 'peer_left': {
				this.peers.delete(msg.userId);
				this.editorBinding.removePeer(msg.userId);
				this._onDidPeerLeave.fire(msg.userId);
				break;
			}

			case 'text_change': {
				if (msg.senderId !== this.currentUser.id) {
					this.editorBinding.applyRemoteChanges(msg.uri, msg.changes);
				}
				break;
			}

			case 'cursor_update': {
				if (msg.senderId !== this.currentUser.id) {
					const user = this.peers.get(msg.senderId);
					if (user) {
						this.editorBinding.updateRemoteCursor(msg.uri, user, msg.selection);
					}
				}
				break;
			}
		}
	}

	public send(msg: CollabMessage): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg));
		}
	}

	public getPeers(): CollabUser[] {
		return Array.from(this.peers.values());
	}

	public disconnect(): void {
		this.ws?.close();
		this.peers.clear();
	}

	public dispose(): void {
		this.disconnect();
		for (const d of this.disposables) {
			d.dispose();
		}
	}
}
