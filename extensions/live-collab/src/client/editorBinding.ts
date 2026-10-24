/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CollabUser, CursorPosition, TextChangeDelta } from '../types';

interface RemotePeerCursor {
	user: CollabUser;
	decorationType: vscode.TextEditorDecorationType;
	labelDecorationType: vscode.TextEditorDecorationType;
}

export class EditorBindingManager implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private readonly peerCursors = new Map<string, RemotePeerCursor>();
	private isApplyingRemoteEdit = false;

	private readonly _onDidLocalChange = new vscode.EventEmitter<{ uri: string; changes: TextChangeDelta[] }>();
	public readonly onDidLocalChange = this._onDidLocalChange.event;

	private readonly _onDidLocalCursorMove = new vscode.EventEmitter<{ uri: string; selection: CursorPosition }>();
	public readonly onDidLocalCursorMove = this._onDidLocalCursorMove.event;

	constructor() {
		// Listen to document changes to broadcast edits
		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument(event => {
				if (this.isApplyingRemoteEdit) {
					return;
				}
				if (event.contentChanges.length === 0) {
					return;
				}

				const relativeUri = this.getRelativeUri(event.document.uri);
				if (!relativeUri) {
					return;
				}

				const changes: TextChangeDelta[] = event.contentChanges.map(c => ({
					range: {
						startLineNumber: c.range.start.line,
						startColumn: c.range.start.character,
						endLineNumber: c.range.end.line,
						endColumn: c.range.end.character,
					},
					rangeLength: c.rangeLength,
					text: c.text,
				}));

				this._onDidLocalChange.fire({ uri: relativeUri, changes });
			})
		);

		// Listen to cursor position changes to broadcast caret positions
		this.disposables.push(
			vscode.window.onDidChangeTextEditorSelection(event => {
				const relativeUri = this.getRelativeUri(event.textEditor.document.uri);
				if (!relativeUri) {
					return;
				}

				const selection: CursorPosition = {
					anchor: { line: event.selections[0].anchor.line, character: event.selections[0].anchor.character },
					active: { line: event.selections[0].active.line, character: event.selections[0].active.character },
				};

				this._onDidLocalCursorMove.fire({ uri: relativeUri, selection });
			})
		);
	}

	/**
	 * Apply edits received from a remote collaborator to the local editor.
	 */
	public async applyRemoteChanges(relativeUri: string, changes: TextChangeDelta[]): Promise<void> {
		const document = await this.findOrOpenDocument(relativeUri);
		if (!document) {
			return;
		}

		this.isApplyingRemoteEdit = true;
		try {
			const edit = new vscode.WorkspaceEdit();
			for (const c of changes) {
				const range = new vscode.Range(
					new vscode.Position(c.range.startLineNumber, c.range.startColumn),
					new vscode.Position(c.range.endLineNumber, c.range.endColumn)
				);
				edit.replace(document.uri, range, c.text);
			}

			await vscode.workspace.applyEdit(edit);

			const config = vscode.workspace.getConfiguration('liveCollab');
			if (config.get<boolean>('autoSaveRemoteChanges', true)) {
				await document.save();
			}
		} finally {
			this.isApplyingRemoteEdit = false;
		}
	}

	/**
	 * Render a remote peer's cursor and selection.
	 */
	public updateRemoteCursor(relativeUri: string, user: CollabUser, selection: CursorPosition): void {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor || this.getRelativeUri(activeEditor.document.uri) !== relativeUri) {
			return;
		}

		let peerCursor = this.peerCursors.get(user.id);
		if (!peerCursor) {
			peerCursor = this.createPeerDecoration(user);
			this.peerCursors.set(user.id, peerCursor);
		}

		const anchorPos = new vscode.Position(selection.anchor.line, selection.anchor.character);
		const activePos = new vscode.Position(selection.active.line, selection.active.character);

		// Caret position line & selection range
		const selectionRange = new vscode.Range(anchorPos, activePos);
		const caretRange = new vscode.Range(activePos, activePos);

		activeEditor.setDecorations(peerCursor.decorationType, [selectionRange]);
		activeEditor.setDecorations(peerCursor.labelDecorationType, [caretRange]);
	}

	/**
	 * Remove cursor decorations for a disconnected peer.
	 */
	public removePeer(userId: string): void {
		const peerCursor = this.peerCursors.get(userId);
		if (peerCursor) {
			peerCursor.decorationType.dispose();
			peerCursor.labelDecorationType.dispose();
			this.peerCursors.delete(userId);
		}
	}

	private createPeerDecoration(user: CollabUser): RemotePeerCursor {
		const decorationType = vscode.window.createTextEditorDecorationType({
			backgroundColor: `${user.color}33`, // 20% opacity highlight for selection
			border: `1px solid ${user.color}`,
		});

		const labelDecorationType = vscode.window.createTextEditorDecorationType({
			border: `2px solid ${user.color}`,
			after: {
				contentText: ` ${user.displayName} `,
				backgroundColor: user.color,
				color: '#FFFFFF',
				margin: '0 0 0 4px',
				fontWeight: 'bold',
			},
		});

		return { user, decorationType, labelDecorationType };
	}

	private getRelativeUri(uri: vscode.Uri): string | undefined {
		const folder = vscode.workspace.getWorkspaceFolder(uri);
		if (!folder) {
			return uri.fsPath;
		}
		return vscode.workspace.asRelativePath(uri, false);
	}

	private async findOrOpenDocument(relativeUri: string): Promise<vscode.TextDocument | undefined> {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return undefined;
		}
		const fullUri = vscode.Uri.joinPath(folder.uri, relativeUri);
		try {
			return await vscode.workspace.openTextDocument(fullUri);
		} catch {
			return undefined;
		}
	}

	public dispose(): void {
		for (const cursor of this.peerCursors.values()) {
			cursor.decorationType.dispose();
			cursor.labelDecorationType.dispose();
		}
		this.peerCursors.clear();
		for (const d of this.disposables) {
			d.dispose();
		}
	}
}
