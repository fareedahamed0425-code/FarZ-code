/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface CollabUser {
	readonly id: string;
	readonly username: string;
	readonly displayName: string;
	readonly avatarUrl: string;
	readonly color: string;
}

export interface TextChangeDelta {
	readonly range: {
		readonly startLineNumber: number;
		readonly startColumn: number;
		readonly endLineNumber: number;
		readonly endColumn: number;
	};
	readonly rangeLength: number;
	readonly text: string;
}

export interface CursorPosition {
	readonly anchor: { readonly line: number; readonly character: number };
	readonly active: { readonly line: number; readonly character: number };
}

export type CollabMessage =
	| {
			type: 'auth_request';
			token: string;
			username: string;
			repoOwner: string;
			repoName: string;
	  }
	| {
			type: 'auth_response';
			success: boolean;
			user?: CollabUser;
			peers?: CollabUser[];
			error?: string;
	  }
	| {
			type: 'peer_joined';
			user: CollabUser;
	  }
	| {
			type: 'peer_left';
			userId: string;
	  }
	| {
			type: 'text_change';
			uri: string;
			version: number;
			changes: TextChangeDelta[];
			senderId: string;
	  }
	| {
			type: 'cursor_update';
			uri: string;
			senderId: string;
			selection: CursorPosition;
	  }
	| {
			type: 'file_request';
			uri: string;
	  }
	| {
			type: 'file_response';
			uri: string;
			content: string;
	  };

export interface SessionInfo {
	readonly sessionId: string;
	readonly hostUsername: string;
	readonly repoOwner: string;
	readonly repoName: string;
	readonly port: number;
	readonly url: string;
	readonly isHost: boolean;
}
