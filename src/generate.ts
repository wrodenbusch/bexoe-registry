/**
 * Extension generation via Claude Code subprocess.
 * Spawns `claude` CLI, streams progress, and returns the generated files.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildGenerationPrompt } from './generate-prompt.js';

export interface GenerateOptions {
	message: string;
	existingSource?: string;
	extensionName?: string;
	onProgress: (message: string) => void;
}

export interface GenerateResult {
	success: boolean;
	tempDir: string;
	error?: string;
}

/**
 * Spawns a Claude Code subprocess to generate an extension.
 * Streams progress events via the onProgress callback.
 */
export async function generateExtension(opts: GenerateOptions): Promise<GenerateResult> {
	const tempDir = mkdtempSync(join(tmpdir(), 'bexoe-gen-'));

	const prompt = buildGenerationPrompt({
		message: opts.message,
		existingSource: opts.existingSource,
		extensionName: opts.extensionName,
	});

	opts.onProgress('Generating extension source...');

	return new Promise((resolve) => {
		const child = spawn('claude', [
			'--print',
			'--output-format', 'stream-json',
			'--allowedTools', 'Write,Bash,Read,Glob',
			'-p', prompt,
		], {
			cwd: tempDir,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, HOME: process.env.HOME },
		});

		let stderr = '';

		child.stdout.on('data', (data: Buffer) => {
			// Parse stream-json output for progress updates
			const lines = data.toString().split('\n').filter(Boolean);
			for (const line of lines) {
				try {
					const event = JSON.parse(line);
					if (event.type === 'assistant' && event.message?.content) {
						for (const block of event.message.content) {
							if (block.type === 'tool_use') {
								if (block.name === 'Write') {
									opts.onProgress(`Writing ${block.input?.file_path || 'file'}...`);
								} else if (block.name === 'Bash') {
									opts.onProgress('Running build command...');
								}
							}
						}
					}
				} catch {
					// Not JSON, skip
				}
			}
		});

		child.stderr.on('data', (data: Buffer) => {
			stderr += data.toString();
		});

		child.on('close', (code) => {
			if (code !== 0) {
				resolve({
					success: false,
					tempDir,
					error: `Claude Code exited with code ${code}: ${stderr.slice(0, 500)}`,
				});
				return;
			}

			// Verify the extension was generated
			const hasPackageJson = existsSync(join(tempDir, 'package.json'));
			const hasExtension = existsSync(join(tempDir, 'out', 'extension.js'));

			if (!hasPackageJson) {
				resolve({
					success: false,
					tempDir,
					error: 'Generation completed but package.json was not created.',
				});
				return;
			}

			if (!hasExtension) {
				resolve({
					success: false,
					tempDir,
					error: 'Generation completed but out/extension.js was not built.',
				});
				return;
			}

			resolve({ success: true, tempDir });
		});

		child.on('error', (err) => {
			resolve({
				success: false,
				tempDir,
				error: `Failed to spawn Claude Code: ${err.message}`,
			});
		});
	});
}

/**
 * Reads the generated extension source from a temp directory.
 */
export function readGeneratedSource(tempDir: string): string | undefined {
	const srcPath = join(tempDir, 'src', 'extension.ts');
	if (existsSync(srcPath)) {
		return readFileSync(srcPath, 'utf-8');
	}
	return undefined;
}
