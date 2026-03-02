import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../src/server.js';

const PORT = 3456;
const BASE = `http://localhost:${PORT}`;
let server: Server;

beforeAll(() => {
	const app = createApp(`${BASE}/api`);
	server = app.listen(PORT);
});

afterAll(() => {
	server.close();
});

describe('POST /api/extensionquery', () => {
	it('returns results for search text filter', async () => {
		const res = await fetch(`${BASE}/api/extensionquery`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filters: [{
					criteria: [{ filterType: 10, value: 'milkdown' }],
					pageNumber: 1,
					pageSize: 50,
					sortBy: 0,
					sortOrder: 0,
				}],
				assetTypes: [],
				flags: 0x3B7, // IncludeVersions | IncludeFiles | IncludeCategoryAndTags | IncludeVersionProperties | IncludeAssetUri | IncludeStatistics | IncludeLatestVersionOnly
			}),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.results).toHaveLength(1);
		expect(data.results[0].extensions).toHaveLength(1);
		expect(data.results[0].extensions[0].extensionName).toBe('milkdown');
		expect(data.results[0].extensions[0].versions).toHaveLength(1);
		expect(data.results[0].extensions[0].versions[0].version).toBe('0.0.1');
		expect(data.results[0].extensions[0].versions[0].assetUri).toContain('/assets/bexoe/milkdown/0.0.1');
		expect(data.results[0].extensions[0].versions[0].files.length).toBeGreaterThan(0);
		expect(data.results[0].extensions[0].statistics).toHaveLength(3);
		expect(data.results[0].extensions[0].tags).toContain('markdown');
		expect(data.results[0].extensions[0].categories).toContain('Visualization');
		expect(data.results[0].resultMetadata[0].metadataItems[0].count).toBe(1);
	});

	it('returns results for extension name filter', async () => {
		const res = await fetch(`${BASE}/api/extensionquery`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filters: [{
					criteria: [{ filterType: 7, value: 'bexoe.milkdown' }],
					pageNumber: 1,
					pageSize: 50,
					sortBy: 0,
					sortOrder: 0,
				}],
				assetTypes: [],
				flags: 0x1,
			}),
		});
		const data = await res.json();
		expect(data.results[0].extensions).toHaveLength(1);
		expect(data.results[0].extensions[0].extensionName).toBe('milkdown');
	});

	it('returns results for extension ID filter', async () => {
		const res = await fetch(`${BASE}/api/extensionquery`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filters: [{
					criteria: [{ filterType: 4, value: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }],
					pageNumber: 1,
					pageSize: 50,
					sortBy: 0,
					sortOrder: 0,
				}],
				assetTypes: [],
				flags: 0x1,
			}),
		});
		const data = await res.json();
		expect(data.results[0].extensions).toHaveLength(1);
		expect(data.results[0].extensions[0].extensionName).toBe('milkdown');
	});

	it('returns empty results for unknown extension', async () => {
		const res = await fetch(`${BASE}/api/extensionquery`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filters: [{
					criteria: [{ filterType: 10, value: 'nonexistent-extension-xyz' }],
					pageNumber: 1,
					pageSize: 50,
					sortBy: 0,
					sortOrder: 0,
				}],
				assetTypes: [],
				flags: 0x1,
			}),
		});
		const data = await res.json();
		expect(data.results[0].extensions).toHaveLength(0);
		expect(data.results[0].resultMetadata[0].metadataItems[0].count).toBe(0);
	});

	it('finds writer extension pack', async () => {
		const res = await fetch(`${BASE}/api/extensionquery`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filters: [{
					criteria: [{ filterType: 10, value: 'writer' }],
					pageNumber: 1,
					pageSize: 50,
					sortBy: 0,
					sortOrder: 0,
				}],
				assetTypes: [],
				flags: 0x11, // IncludeVersions | IncludeVersionProperties
			}),
		});
		const data = await res.json();
		expect(data.results[0].extensions).toHaveLength(1);
		const ext = data.results[0].extensions[0];
		expect(ext.displayName).toBe('Writer');
		// Check extension pack property
		const packProp = ext.versions[0].properties.find(
			(p: { key: string }) => p.key === 'Microsoft.VisualStudio.Code.ExtensionPack'
		);
		expect(packProp).toBeDefined();
		expect(packProp.value).toBe('bexoe.milkdown');
	});

	it('respects flags for what to include', async () => {
		// No versions flag
		const res = await fetch(`${BASE}/api/extensionquery`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filters: [{
					criteria: [{ filterType: 10, value: 'milkdown' }],
					pageNumber: 1,
					pageSize: 50,
					sortBy: 0,
					sortOrder: 0,
				}],
				assetTypes: [],
				flags: 0x0,
			}),
		});
		const data = await res.json();
		const ext = data.results[0].extensions[0];
		expect(ext.versions).toHaveLength(0);
		expect(ext.statistics).toHaveLength(0);
		expect(ext.tags).toHaveLength(0);
		expect(ext.categories).toHaveLength(0);
	});
});

describe('GET /api/control', () => {
	it('returns empty control manifest', async () => {
		const res = await fetch(`${BASE}/api/control`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toEqual({
			malicious: [],
			deprecated: {},
			search: [],
			autoUpdate: {},
		});
	});
});

describe('GET /api/assets/:publisher/:name/:version/:assetType', () => {
	it('serves VSIX package', async () => {
		const res = await fetch(`${BASE}/api/assets/bexoe/milkdown/0.0.1/Microsoft.VisualStudio.Services.VSIXPackage`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/vsix');
		const body = await res.arrayBuffer();
		expect(body.byteLength).toBeGreaterThan(1000);
	});

	it('serves icon', async () => {
		const res = await fetch(`${BASE}/api/assets/bexoe/milkdown/0.0.1/Microsoft.VisualStudio.Services.Icons.Default`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/png');
	});

	it('serves README', async () => {
		const res = await fetch(`${BASE}/api/assets/bexoe/milkdown/0.0.1/Microsoft.VisualStudio.Services.Content.Details`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/markdown');
	});

	it('serves package.json manifest', async () => {
		const res = await fetch(`${BASE}/api/assets/bexoe/milkdown/0.0.1/Microsoft.VisualStudio.Code.Manifest`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/json');
	});

	it('returns 404 for unknown asset type', async () => {
		const res = await fetch(`${BASE}/api/assets/bexoe/milkdown/0.0.1/Unknown.Asset.Type`);
		expect(res.status).toBe(404);
	});

	it('returns 404 for nonexistent extension', async () => {
		const res = await fetch(`${BASE}/api/assets/bexoe/nonexistent/0.0.1/Microsoft.VisualStudio.Services.VSIXPackage`);
		expect(res.status).toBe(404);
	});

	it('serves writer extension pack VSIX', async () => {
		const res = await fetch(`${BASE}/api/assets/bexoe/writer-environment/0.0.1/Microsoft.VisualStudio.Services.VSIXPackage`);
		expect(res.status).toBe(200);
	});
});

describe('GET /api/vscode/:publisher/:name/latest', () => {
	it('returns extension metadata', async () => {
		const res = await fetch(`${BASE}/api/vscode/bexoe/milkdown/latest`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.extensionName).toBe('milkdown');
		expect(data.publisher.publisherName).toBe('bexoe');
	});

	it('returns 404 for unknown extension', async () => {
		const res = await fetch(`${BASE}/api/vscode/bexoe/nonexistent/latest`);
		expect(res.status).toBe(404);
	});
});

describe('POST /api/publishers/:publisher/extensions/:name/:version/stats', () => {
	it('accepts stats (no-op)', async () => {
		const res = await fetch(`${BASE}/api/publishers/bexoe/extensions/milkdown/0.0.1/stats`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ downloads: 1 }),
		});
		expect(res.status).toBe(200);
	});
});
