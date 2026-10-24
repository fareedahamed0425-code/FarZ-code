/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CollabUser, SessionInfo } from '../types';

export class PeersTreeDataProvider implements vscode.TreeDataProvider<CollabTreeItem> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<CollabTreeItem | undefined | null | void>();
	public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private peers: CollabUser[] = [];

	public updatePeers(peers: CollabUser[]): void {
		this.peers = peers;
		this._onDidChangeTreeData.fire();
	}

	public getTreeItem(element: CollabTreeItem): vscode.TreeItem {
		return element;
	}

	public getChildren(): Thenable<CollabTreeItem[]> {
		if (this.peers.length === 0) {
			return Promise.resolve([
				new CollabTreeItem('No active collaborators', 'Start or join a session to collaborate', vscode.TreeItemCollapsibleState.None, new vscode.ThemeIcon('info'))
			]);
		}

		return Promise.resolve(
			this.peers.map(peer => {
				const item = new CollabTreeItem(
					peer.displayName,
					`@${peer.username}`,
					vscode.TreeItemCollapsibleState.None,
					new vscode.ThemeIcon('account')
				);
				item.tooltip = `Active collaborator: ${peer.username}`;
				return item;
			})
		);
	}
}

export class SessionTreeDataProvider implements vscode.TreeDataProvider<CollabTreeItem> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<CollabTreeItem | undefined | null | void>();
	public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private session?: SessionInfo;

	public updateSession(session?: SessionInfo): void {
		this.session = session;
		this._onDidChangeTreeData.fire();
	}

	public getTreeItem(element: CollabTreeItem): vscode.TreeItem {
		return element;
	}

	public getChildren(): Thenable<CollabTreeItem[]> {
		if (!this.session) {
			return Promise.resolve([
				new CollabTreeItem('Session: Inactive', 'Click "Start Session" to host', vscode.TreeItemCollapsibleState.None, new vscode.ThemeIcon('circle-outline'))
			]);
		}

		return Promise.resolve([
			new CollabTreeItem('Status', this.session.isHost ? 'Hosting' : 'Connected as Guest', vscode.TreeItemCollapsibleState.None, new vscode.ThemeIcon('radio-tower')),
			new CollabTreeItem('Repository', `${this.session.repoOwner}/${this.repoName(this.session)}`, vscode.TreeItemCollapsibleState.None, new vscode.ThemeIcon('repo')),
			new CollabTreeItem('Host', `@${this.session.hostUsername}`, vscode.TreeItemCollapsibleState.None, new vscode.ThemeIcon('person')),
			new CollabTreeItem('Server URL', this.session.url, vscode.TreeItemCollapsibleState.None, new vscode.ThemeIcon('link')),
			new CollabTreeItem('Session ID', this.session.sessionId, vscode.TreeItemCollapsibleState.None, new vscode.ThemeIcon('key')),
		]);
	}

	private repoName(session: SessionInfo): string {
		return session.repoName;
	}
}

export class CollabTreeItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly description: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly iconPath?: vscode.ThemeIcon
	) {
		super(label, collapsibleState);
		this.description = description;
		this.iconPath = iconPath;
	}
}

export class CollabStatusBarManager implements vscode.Disposable {
	private readonly statusBarItem: vscode.StatusBarItem;

	constructor() {
		this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		this.statusBarItem.command = 'liveCollab.startSession';
		this.setIdle();
		this.statusBarItem.show();
	}

	public setIdle(): void {
		this.statusBarItem.text = '$(broadcast) Collab: Off';
		this.statusBarItem.tooltip = 'Click to start or join a collaboration session';
		this.statusBarItem.command = 'liveCollab.startSession';
	}

	public setHosting(peerCount: number, repo: string): void {
		this.statusBarItem.text = `$(radio-tower) Collab: Hosting (${peerCount} peers)`;
		this.statusBarItem.tooltip = `Hosting live session on ${repo}. Click for session options.`;
		this.statusBarItem.command = 'liveCollab.copyInviteLink';
	}

	public setConnected(host: string): void {
		this.statusBarItem.text = `$(plug) Collab: Connected (@${host})`;
		this.statusBarItem.tooltip = `Connected to collaboration host @${host}. Click to view session.`;
		this.statusBarItem.command = 'liveCollab.copyInviteLink';
	}

	public dispose(): void {
		this.statusBarItem.dispose();
	}
}
