import express from 'express';
import { join } from 'node:path';
import { existsSync, createReadStream, statSync, rmSync, readFileSync } from 'node:fs';
import { handleQuery } from './query.js';
import { getDataDir, findExtensionByName, searchExtensions, getExtensionSource } from './index.js';
import { generateExtension, readGeneratedSource } from './generate.js';
import { publishExtension } from './publish.js';
import { deriveExtensionName } from './generate-prompt.js';
import type { ExtensionQueryRequest, GenerateRequest, GenerateEvent } from './types.js';

export function createApp(baseUrl?: string): express.Express {
	const app = express();
	app.set('trust proxy', true);
	app.use((_req, res, next) => {
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
		if (_req.method === 'OPTIONS') {
			res.sendStatus(204);
			return;
		}
		next();
	});
	app.use(express.json());

	// POST /api/extensionquery — main search/browse endpoint
	app.post('/api/extensionquery', (req, res) => {
		const resolvedBaseUrl = baseUrl ?? `${req.protocol}://${req.get('host')}/api`;
		const body = req.body as ExtensionQueryRequest;
		const result = handleQuery(body, resolvedBaseUrl);
		res.json(result);
	});

	// GET /api/control — return empty control manifest
	app.get('/api/control', (_req, res) => {
		res.json({
			malicious: [],
			deprecated: {},
			search: [],
			autoUpdate: {},
		});
	});

	// GET /api/vscode/:publisher/:name/latest — single extension lookup
	app.get('/api/vscode/:publisher/:name/latest', (req, res) => {
		const ext = findExtensionByName(req.params.publisher, req.params.name);
		if (!ext) {
			res.status(404).json({ error: 'Extension not found' });
			return;
		}
		res.json(ext);
	});

	// GET /api/assets/:publisher/:name/:version/:assetType — serve assets
	app.get('/api/assets/:publisher/:name/:version/:assetType', (req, res) => {
		const { publisher, name, version, assetType } = req.params;
		const dataDir = getDataDir();

		// Map asset types to file paths
		const assetPaths: Record<string, { dir: string; filename: string; contentType: string }> = {
			'Microsoft.VisualStudio.Services.VSIXPackage': {
				dir: join(dataDir, 'extensions', publisher, name, version),
				filename: `${publisher}.${name}-${version}.vsix`,
				contentType: 'application/vsix',
			},
			'Microsoft.VisualStudio.Services.Icons.Default': {
				dir: join(dataDir, 'assets', publisher, name, version),
				filename: 'icon.png',
				contentType: 'image/png',
			},
			'Microsoft.VisualStudio.Services.Content.Details': {
				dir: join(dataDir, 'assets', publisher, name, version),
				filename: 'README.md',
				contentType: 'text/markdown',
			},
			'Microsoft.VisualStudio.Services.Content.Changelog': {
				dir: join(dataDir, 'assets', publisher, name, version),
				filename: 'CHANGELOG.md',
				contentType: 'text/markdown',
			},
			'Microsoft.VisualStudio.Code.Manifest': {
				dir: join(dataDir, 'assets', publisher, name, version),
				filename: 'package.json',
				contentType: 'application/json',
			},
			'Microsoft.VisualStudio.Services.Content.License': {
				dir: join(dataDir, 'assets', publisher, name, version),
				filename: 'LICENSE',
				contentType: 'text/plain',
			},
		};

		const mapping = assetPaths[assetType];
		if (!mapping) {
			res.status(404).json({ error: `Unknown asset type: ${assetType}` });
			return;
		}

		const filePath = join(mapping.dir, mapping.filename);
		if (!existsSync(filePath)) {
			res.status(404).json({ error: 'Asset not found' });
			return;
		}

		const stat = statSync(filePath);
		res.setHeader('Content-Type', mapping.contentType);
		res.setHeader('Content-Length', stat.size);
		createReadStream(filePath).pipe(res);
	});

	// POST /api/generate — generate, build, and publish an extension (SSE)
	app.post('/api/generate', async (req, res) => {
		const body = req.body as GenerateRequest;
		if (!body.message) {
			res.status(400).json({ error: 'message is required' });
			return;
		}

		// Set up SSE
		res.setHeader('Content-Type', 'text/event-stream');
		res.setHeader('Cache-Control', 'no-cache');
		res.setHeader('Connection', 'keep-alive');
		res.flushHeaders();

		const sendEvent = (event: GenerateEvent) => {
			res.write(`data: ${JSON.stringify(event)}\n\n`);
		};

		try {
			// Determine extension name and branch
			const extensionName = body.extensionName || deriveExtensionName(body.message);
			let branch = body.branch || 'main';
			let existingSource: string | undefined;
			let parentBranch: string | undefined;

			// Search for similar extensions (branch-first)
			if (!body.extensionName) {
				sendEvent({ type: 'progress', message: 'Searching for similar extensions...' });
				// Search by full message first, then by individual keywords
				let matches = searchExtensions(body.message);
				if (matches.length === 0) {
					const keywords = body.message.toLowerCase().split(/\s+/).filter(w => w.length > 3);
					for (const kw of keywords) {
						const kwMatches = searchExtensions(kw);
						if (kwMatches.length > 0) {
							matches = kwMatches;
							break;
						}
					}
				}

				if (matches.length > 0) {
					const best = matches[0];
					// Check if this is an exact match (same name)
					const bestName = best.extensionName;
					const bestBranch = best.branch || 'main';

					// Try to read source from best match for branching
					const source = getExtensionSource(bestName, bestBranch);
					if (source) {
						existingSource = source;
						parentBranch = bestBranch;
						// Generate a branch name for the customization
						branch = deriveExtensionName(body.message);
						sendEvent({
							type: 'progress',
							message: `Branching from ${bestName} (${bestBranch}) and adapting...`,
							extensionName: bestName,
						});
					}
				}

				if (!existingSource) {
					sendEvent({ type: 'progress', message: 'No similar extensions found. Generating from scratch...' });
				}
			} else {
				// Explicit extension specified — update or branch
				const source = getExtensionSource(body.extensionName, branch);
				if (source) {
					existingSource = source;
					sendEvent({ type: 'progress', message: `Updating ${body.extensionName} (branch: ${branch})...` });
				}
			}

			// Generate via Claude Code
			const result = await generateExtension({
				message: body.message,
				existingSource,
				extensionName,
				onProgress: (msg) => sendEvent({ type: 'progress', message: msg }),
			});

			if (!result.success) {
				sendEvent({ type: 'error', message: result.error || 'Generation failed' });
				res.end();
				cleanup(result.tempDir);
				return;
			}

			// Read package.json from generated output for metadata
			const pkgPath = join(result.tempDir, 'package.json');
			let displayName = extensionName;
			let description = body.message;
			if (existsSync(pkgPath)) {
				try {
					const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
					displayName = pkg.displayName || extensionName;
					description = pkg.description || body.message;
				} catch {
					// Use defaults
				}
			}

			// Publish
			sendEvent({ type: 'progress', message: 'Publishing to registry...' });
			const version = '0.1.0'; // TODO: increment for updates
			const pubResult = await publishExtension({
				sourceDir: result.tempDir,
				name: extensionName,
				branch,
				version,
				generationPrompt: body.message,
				parentBranch,
				displayName,
				description,
			});

			if (!pubResult.success) {
				sendEvent({ type: 'error', message: pubResult.error || 'Publishing failed' });
				res.end();
				cleanup(result.tempDir);
				return;
			}

			sendEvent({
				type: 'complete',
				message: 'Extension published!',
				extensionId: pubResult.extensionId,
				extensionName,
				branch,
				version,
			});
			res.end();
			cleanup(result.tempDir);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			sendEvent({ type: 'error', message: msg });
			res.end();
		}
	});

	// POST /api/publishers/:publisher/extensions/:name/:version/stats — accept stats (no-op)
	app.post('/api/publishers/:publisher/extensions/:name/:version/stats', (_req, res) => {
		res.status(200).json({ ok: true });
	});

	return app;
}

function cleanup(dir: string): void {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		// Best effort
	}
}

const PORT = parseInt(process.env.PORT ?? '3000', 10);

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
	const app = createApp();
	app.listen(PORT, () => {
		console.log(`Bexoe registry listening on port ${PORT}`);
	});
}
