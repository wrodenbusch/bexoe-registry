/**
 * Publishes a generated extension to the registry.
 * Handles Git repo management, VSIX placement, asset extraction, and index updates.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { getDataDir, loadIndex, invalidateCache } from './index.js';
import { createVsix } from './vsix.js';
import type { ExtensionEntry, ExtensionVersion, ExtensionFile } from './types.js';

const PUBLISHER = 'bexoe';
const PUBLISHER_ID = 'bexoe-publisher';

export interface PublishOptions {
	/** Directory containing the built extension */
	sourceDir: string;
	/** Extension name (kebab-case) */
	name: string;
	/** Branch name ("main" for new extensions, custom name for variants) */
	branch: string;
	/** Version string (e.g., "0.1.0") */
	version: string;
	/** User's original generation prompt */
	generationPrompt: string;
	/** Parent branch (if this is a customization) */
	parentBranch?: string;
	/** Display name */
	displayName?: string;
	/** Short description */
	description?: string;
}

export interface PublishResult {
	success: boolean;
	extensionId?: string;
	error?: string;
}

/**
 * Publishes an extension: commits to Git repo, packages VSIX, updates index.
 */
export async function publishExtension(opts: PublishOptions): Promise<PublishResult> {
	const dataDir = getDataDir();

	try {
		// Read package.json from source for metadata
		const pkgPath = join(opts.sourceDir, 'package.json');
		if (!existsSync(pkgPath)) {
			return { success: false, error: 'No package.json in source directory' };
		}
		const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
		const displayName = opts.displayName || pkg.displayName || opts.name;
		const description = opts.description || pkg.description || '';

		// 1. Manage Git repo
		const repoDir = join(dataDir, 'repos', PUBLISHER, `${opts.name}.git`);
		commitToRepo(repoDir, opts.sourceDir, opts.branch, opts.parentBranch, opts.version, opts.generationPrompt);

		// 2. Package VSIX
		const vsixDir = join(dataDir, 'extensions', PUBLISHER, opts.name, opts.branch, opts.version);
		mkdirSync(vsixDir, { recursive: true });
		const vsixPath = join(vsixDir, `${PUBLISHER}.${opts.name}-${opts.version}.vsix`);
		await createVsix({
			sourceDir: opts.sourceDir,
			outputPath: vsixPath,
			publisher: PUBLISHER,
			name: opts.name,
			version: opts.version,
		});

		// 3. Copy assets
		const assetDir = join(dataDir, 'assets', PUBLISHER, opts.name, opts.branch, opts.version);
		mkdirSync(assetDir, { recursive: true });
		copyAsset(opts.sourceDir, assetDir, 'package.json');
		copyAsset(opts.sourceDir, assetDir, 'README.md');
		copyAsset(opts.sourceDir, assetDir, 'CHANGELOG.md');
		copyAsset(opts.sourceDir, assetDir, 'icon.png');
		copyAsset(opts.sourceDir, assetDir, 'LICENSE');

		// 4. Update index.json
		const extensionId = addToIndex(dataDir, {
			name: opts.name,
			branch: opts.branch,
			version: opts.version,
			displayName,
			description,
			generationPrompt: opts.generationPrompt,
			parentBranch: opts.parentBranch,
		});

		invalidateCache();

		return { success: true, extensionId };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { success: false, error: msg };
	}
}

/**
 * Commits generated files to the extension's bare Git repo.
 */
function commitToRepo(
	repoDir: string,
	sourceDir: string,
	branch: string,
	parentBranch: string | undefined,
	version: string,
	message: string,
): void {
	const isNew = !existsSync(repoDir);

	if (isNew) {
		mkdirSync(join(repoDir, '..'), { recursive: true });
		execSync(`git init --bare "${repoDir}"`);
	}

	// Create a temporary worktree
	const worktreeDir = `${sourceDir}-worktree`;
	try {
		if (isNew) {
			// New repo: create an orphan branch
			execSync(`git worktree add --orphan -b "${branch}" "${worktreeDir}"`, { cwd: repoDir });
		} else if (branchExists(repoDir, branch)) {
			// Existing branch: check it out
			execSync(`git worktree add "${worktreeDir}" "${branch}"`, { cwd: repoDir });
		} else {
			// New branch from parent
			const base = parentBranch && branchExists(repoDir, parentBranch) ? parentBranch : 'main';
			execSync(`git worktree add -b "${branch}" "${worktreeDir}" "${base}"`, { cwd: repoDir });
		}

		// Copy source files into worktree (excluding .git)
		copyDirContents(sourceDir, worktreeDir);

		// Stage, commit, and tag
		execSync('git add -A', { cwd: worktreeDir });
		execSync(`git commit -m "${message.replace(/"/g, '\\"')}" --allow-empty`, { cwd: worktreeDir });
		execSync(`git tag "${branch}/v${version}"`, { cwd: worktreeDir });
	} finally {
		// Clean up worktree
		try {
			execSync(`git worktree remove --force "${worktreeDir}"`, { cwd: repoDir });
		} catch {
			// Best effort cleanup
		}
	}
}

function branchExists(repoDir: string, branch: string): boolean {
	try {
		execSync(`git rev-parse --verify "${branch}"`, { cwd: repoDir, stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

function copyDirContents(src: string, dest: string): void {
	const entries = readdirSync(src, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name === '.git' || entry.name === 'node_modules') {
			continue;
		}
		const srcPath = join(src, entry.name);
		const destPath = join(dest, entry.name);
		if (entry.isDirectory()) {
			mkdirSync(destPath, { recursive: true });
			copyDirContents(srcPath, destPath);
		} else {
			copyFileSync(srcPath, destPath);
		}
	}
}

function copyAsset(sourceDir: string, assetDir: string, filename: string): void {
	const src = join(sourceDir, filename);
	if (existsSync(src)) {
		copyFileSync(src, join(assetDir, filename));
	}
}

/**
 * Adds or updates an extension entry in index.json.
 */
function addToIndex(dataDir: string, opts: {
	name: string;
	branch: string;
	version: string;
	displayName: string;
	description: string;
	generationPrompt: string;
	parentBranch?: string;
}): string {
	const indexPath = join(dataDir, 'index.json');
	const index = loadIndex();
	const now = new Date().toISOString();

	// Check if this extension+branch already exists
	const existing = index.extensions.find(
		e => e.extensionName === opts.name
			&& e.publisher.publisherName === PUBLISHER
			&& (e as ExtensionEntryWithBranch).branch === opts.branch,
	);

	const versionEntry: ExtensionVersion = {
		version: opts.version,
		lastUpdated: now,
		files: buildFileList(),
		properties: [
			{ key: 'Microsoft.VisualStudio.Code.Engine', value: '^1.100.0' },
			{ key: 'Microsoft.VisualStudio.Code.ExecutesCode', value: 'true' },
		],
	};

	if (existing) {
		// Update existing entry: add new version
		existing.versions.unshift(versionEntry);
		existing.lastUpdated = now;
	} else {
		// Create new entry
		const extensionId = randomUUID();
		const entry: ExtensionEntryWithBranch = {
			extensionId,
			publisher: {
				publisherId: PUBLISHER_ID,
				publisherName: PUBLISHER,
				displayName: 'Bexoe',
			},
			extensionName: opts.name,
			displayName: opts.displayName,
			shortDescription: opts.description,
			categories: ['Other'],
			tags: ['bexoe', 'generated'],
			versions: [versionEntry],
			statistics: [
				{ statisticName: 'install', value: 0 },
				{ statisticName: 'averagerating', value: 0 },
				{ statisticName: 'ratingcount', value: 0 },
				{ statisticName: 'branchcount', value: 0 },
			],
			releaseDate: now,
			publishedDate: now,
			lastUpdated: now,
			// Bexoe extensions
			branch: opts.branch,
			parentBranch: opts.parentBranch,
			generatedBy: 'claude-code',
			generationPrompt: opts.generationPrompt,
		};
		index.extensions.push(entry);

		writeFileSync(indexPath, JSON.stringify(index, null, '\t') + '\n');
		return extensionId;
	}

	writeFileSync(indexPath, JSON.stringify(index, null, '\t') + '\n');
	return existing.extensionId;
}

function buildFileList(): ExtensionFile[] {
	return [
		{ assetType: 'Microsoft.VisualStudio.Services.VSIXPackage', source: '' },
		{ assetType: 'Microsoft.VisualStudio.Code.Manifest', source: 'extension/package.json' },
		{ assetType: 'Microsoft.VisualStudio.Services.Content.Details', source: 'extension/README.md' },
	];
}

// Extended type for Bexoe-specific fields
interface ExtensionEntryWithBranch extends ExtensionEntry {
	branch: string;
	parentBranch?: string;
	generatedBy: 'claude-code' | 'manual';
	generationPrompt?: string;
}
