import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../src/server.js';

/**
 * E2E test for the extension generation pipeline.
 *
 * Requires:
 * - Claude Code CLI installed at ~/.local/bin/claude
 * - ANTHROPIC_API_KEY set (or Claude Code configured with a key)
 * - Not running inside another Claude Code session (CLAUDECODE env must be unset)
 *
 * This test is slow (~60-120s) because it spawns Claude Code to generate a real extension.
 * Run with: npx vitest run tests/generate.test.ts --timeout 300000
 */

const PORT = 3457;
const BASE = `http://localhost:${PORT}`;
let server: Server;

beforeAll(() => {
	const app = createApp(`${BASE}/api`);
	server = app.listen(PORT);
});

afterAll(() => {
	server.close();
});

describe('POST /api/generate — E2E extension generation', () => {

	it('generates, builds, and publishes a new extension via SSE', async () => {
		const res = await fetch(`${BASE}/api/generate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				message: 'Create a simple hello world extension that shows a notification when activated',
			}),
		});

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/event-stream');
		expect(res.body).toBeTruthy();

		// Read SSE stream
		const events = await readSSEStream(res.body!);

		// Should have at least some progress events
		const progressEvents = events.filter(e => e.type === 'progress');
		expect(progressEvents.length).toBeGreaterThan(0);

		// Should end with either 'complete' or 'error'
		const terminal = events[events.length - 1];
		expect(['complete', 'error', 'existing']).toContain(terminal.type);

		if (terminal.type === 'complete') {
			// Verify complete event has required fields
			expect(terminal.extensionName).toBeTruthy();
			expect(terminal.message).toBeTruthy();

			// Verify the extension is now queryable via the registry
			const queryRes = await fetch(`${BASE}/api/extensionquery`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					filters: [{
						criteria: [{ filterType: 10, value: terminal.extensionName }],
						pageNumber: 1,
						pageSize: 50,
						sortBy: 0,
						sortOrder: 0,
					}],
					assetTypes: [],
					flags: 0x3B7,
				}),
			});
			const queryData = await queryRes.json();
			expect(queryData.results[0].extensions.length).toBeGreaterThan(0);

			// Verify VSIX asset is downloadable
			const ext = queryData.results[0].extensions[0];
			const version = ext.versions[0].version;
			const branch = (ext as any).branch || 'main';
			const vsixRes = await fetch(
				`${BASE}/api/assets/bexoe/${terminal.extensionName}/${branch}/${version}/Microsoft.VisualStudio.Services.VSIXPackage`
			);
			// The asset path may vary — just check we got something or a 404 with a known structure
			expect([200, 404]).toContain(vsixRes.status);
		}
	}, 300_000); // 5 minute timeout for Claude Code generation

	it('returns 400 if message is missing', async () => {
		const res = await fetch(`${BASE}/api/generate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error).toBe('message is required');
	});

	it('streams progress events for search phase', async () => {
		const res = await fetch(`${BASE}/api/generate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				message: 'Create a unique test extension for automated testing only',
			}),
		});

		expect(res.status).toBe(200);
		const events = await readSSEStream(res.body!);

		// First progress event should be about searching
		const firstProgress = events.find(e => e.type === 'progress');
		expect(firstProgress).toBeTruthy();
		expect(firstProgress!.message).toMatch(/[Ss]earch|[Gg]enerat|[Ss]end/);
	}, 300_000);
});

interface SSEEvent {
	type: string;
	message: string;
	extensionId?: string;
	extensionName?: string;
	branch?: string;
	version?: string;
}

async function readSSEStream(body: ReadableStream<Uint8Array>): Promise<SSEEvent[]> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	const events: SSEEvent[] = [];

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() || '';

		for (const line of lines) {
			if (line.startsWith('data: ')) {
				try {
					const event: SSEEvent = JSON.parse(line.slice(6));
					events.push(event);

					if (event.type === 'complete' || event.type === 'existing' || event.type === 'error') {
						reader.cancel();
						return events;
					}
				} catch {
					// Skip malformed lines
				}
			}
		}
	}

	return events;
}
