import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionIndex, ExtensionEntry } from './types.js';

const DATA_DIR = join(import.meta.dirname, '..', 'data');
const INDEX_PATH = join(DATA_DIR, 'index.json');

let cachedIndex: ExtensionIndex | null = null;

export function getDataDir(): string {
	return DATA_DIR;
}

export function loadIndex(): ExtensionIndex {
	if (cachedIndex) {
		return cachedIndex;
	}
	if (!existsSync(INDEX_PATH)) {
		cachedIndex = { extensions: [] };
		return cachedIndex;
	}
	const raw = readFileSync(INDEX_PATH, 'utf-8');
	cachedIndex = JSON.parse(raw) as ExtensionIndex;
	return cachedIndex;
}

export function invalidateCache(): void {
	cachedIndex = null;
}

export function findExtensionByName(publisherName: string, extensionName: string): ExtensionEntry | undefined {
	const index = loadIndex();
	return index.extensions.find(
		e => e.publisher.publisherName.toLowerCase() === publisherName.toLowerCase()
			&& e.extensionName.toLowerCase() === extensionName.toLowerCase()
	);
}

export function findExtensionById(extensionId: string): ExtensionEntry | undefined {
	const index = loadIndex();
	return index.extensions.find(e => e.extensionId === extensionId);
}

export function searchExtensions(text: string): ExtensionEntry[] {
	const index = loadIndex();
	const lower = text.toLowerCase();
	return index.extensions.filter(e =>
		e.extensionName.toLowerCase().includes(lower)
		|| e.displayName.toLowerCase().includes(lower)
		|| e.shortDescription.toLowerCase().includes(lower)
		|| e.tags.some(t => t.toLowerCase().includes(lower))
	);
}
