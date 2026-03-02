import express from 'express';
import { join } from 'node:path';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { handleQuery } from './query.js';
import { getDataDir, findExtensionByName } from './index.js';
import type { ExtensionQueryRequest } from './types.js';

export function createApp(baseUrl?: string): express.Express {
	const app = express();
	app.set('trust proxy', true);
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

	// POST /api/publishers/:publisher/extensions/:name/:version/stats — accept stats (no-op)
	app.post('/api/publishers/:publisher/extensions/:name/:version/stats', (_req, res) => {
		res.status(200).json({ ok: true });
	});

	return app;
}

const PORT = parseInt(process.env.PORT ?? '3000', 10);

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
	const app = createApp();
	app.listen(PORT, () => {
		console.log(`Bexoe registry listening on port ${PORT}`);
	});
}
