/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as https from 'https';
import { CollabUser } from '../types';

export interface RepoDetails {
	readonly owner: string;
	readonly repo: string;
}

export class GitHubCollabManager {
	private static readonly USER_COLORS = [
		'#FF5722', '#4CAF50', '#2196F3', '#9C27B0',
		'#E91E63', '#00BCD4', '#FF9800', '#3F51B5',
		'#009688', '#673AB7', '#795548', '#607D8B'
	];

	/**
	 * Retrieve a GitHub authentication session.
	 */
	public static async getSession(createIfNone = true): Promise<vscode.AuthenticationSession | undefined> {
		return vscode.authentication.getSession('github', ['repo', 'read:user'], { createIfNone });
	}

	/**
	 * Extract GitHub repo details (owner, repo) from workspace Git remotes.
	 */
	public static async getWorkspaceRepoDetails(): Promise<RepoDetails | undefined> {
		try {
			const gitExtension = vscode.extensions.getExtension('vscode.git');
			if (gitExtension) {
				const git = gitExtension.exports.getAPI(1);
				if (git && git.repositories.length > 0) {
					for (const repo of git.repositories) {
						for (const remote of repo.state.remotes) {
							const url = remote.pushUrl || remote.fetchUrl;
							if (url) {
								const parsed = this.parseGitHubUrl(url);
								if (parsed) {
									return parsed;
								}
							}
						}
					}
				}
			}
		} catch (e) {
			console.error('Error fetching git repo details:', e);
		}

		// Fallback: prompt user for repo details if git is not initialized or remote not set
		return undefined;
	}

	/**
	 * Parse GitHub owner and repo from an SSH or HTTPS git remote URL.
	 */
	public static parseGitHubUrl(url: string): RepoDetails | undefined {
		// Examples:
		// git@github.com:owner/repo.git
		// https://github.com/owner/repo.git
		// https://token@github.com/owner/repo
		const regex = /(?:git@github\.com:|https:\/\/(?:[a-zA-Z0-9_\-.]+@)?github\.com\/)([^/]+)\/([^/.]+)(?:\.git)?/;
		const match = url.trim().match(regex);
		if (match) {
			return {
				owner: match[1],
				repo: match[2],
			};
		}
		return undefined;
	}

	/**
	 * Verify whether a user is a collaborator on the given GitHub repository.
	 * Checks via GitHub API /repos/:owner/:repo/collaborators/:username/permission
	 */
	public static async verifyCollaborator(
		token: string,
		owner: string,
		repo: string,
		username: string
	): Promise<{ isCollaborator: boolean; permission?: string; error?: string }> {
		return new Promise(resolve => {
			const options: https.RequestOptions = {
				hostname: 'api.github.com',
				path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(username)}/permission`,
				method: 'GET',
				headers: {
					'User-Agent': 'VSCode-LiveCollab',
					'Authorization': `Bearer ${token}`,
					'Accept': 'application/vnd.github.v3+json',
				},
			};

			const req = https.request(options, res => {
				let body = '';
				res.on('data', chunk => {
					body += chunk;
				});

				res.on('end', () => {
					if (res.statusCode === 200) {
						try {
							const parsed = JSON.parse(body);
							// permission can be 'admin', 'write', 'read', 'none'
							const perm = parsed.permission || (parsed.role_name);
							const hasWrite = perm === 'admin' || perm === 'write' || perm === 'maintain';
							resolve({ isCollaborator: hasWrite, permission: perm });
						} catch {
							resolve({ isCollaborator: false, error: 'Failed to parse GitHub permission response' });
						}
					} else if (res.statusCode === 404 || res.statusCode === 403) {
						resolve({ isCollaborator: false, error: 'User is not a collaborator or insufficient repository access' });
					} else {
						resolve({ isCollaborator: false, error: `GitHub API error (status ${res.statusCode}): ${body}` });
					}
				});
			});

			req.on('error', err => {
				resolve({ isCollaborator: false, error: err.message });
			});

			req.end();
		});
	}

	/**
	 * Generate a deterministic color for a user based on their username.
	 */
	public static getColorForUser(username: string): string {
		let hash = 0;
		for (let i = 0; i < username.length; i++) {
			hash = username.charCodeAt(i) + ((hash << 5) - hash);
		}
		const index = Math.abs(hash) % this.USER_COLORS.length;
		return this.USER_COLORS[index];
	}

	/**
	 * Construct a CollabUser object from a GitHub authentication session.
	 */
	public static createCollabUser(session: vscode.AuthenticationSession): CollabUser {
		const username = session.account.label;
		return {
			id: session.account.id || username,
			username,
			displayName: session.account.label,
			avatarUrl: `https://github.com/${username}.png`,
			color: this.getColorForUser(username),
		};
	}
}
