import type {
	ExtensionQueryRequest,
	ExtensionEntry,
	QueryResult,
	RawGalleryExtension,
	RawGalleryVersion,
	QueryFilter,
} from './types.js';
import { FilterType, Flag } from './types.js';
import { loadIndex, findExtensionByName, findExtensionById, searchExtensions } from './index.js';

export function handleQuery(body: ExtensionQueryRequest, baseUrl: string): QueryResult {
	const filter = body.filters?.[0];
	const flags = body.flags ?? 0;

	let extensions: ExtensionEntry[];

	if (!filter || !filter.criteria || filter.criteria.length === 0) {
		extensions = loadIndex().extensions;
	} else {
		extensions = resolveFilter(filter);
	}

	// Pagination
	const pageSize = filter?.pageSize ?? 50;
	const pageNumber = filter?.pageNumber ?? 1;
	const start = (pageNumber - 1) * pageSize;
	const totalCount = extensions.length;
	const paged = extensions.slice(start, start + pageSize);

	const rawExtensions = paged.map(e => toRawExtension(e, flags, baseUrl));

	return {
		results: [{
			extensions: rawExtensions,
			resultMetadata: [{
				metadataType: 'ResultCount',
				metadataItems: [{ name: 'TotalCount', count: totalCount }],
			}],
		}],
	};
}

function resolveFilter(filter: QueryFilter): ExtensionEntry[] {
	let results: ExtensionEntry[] | null = null;

	for (const criterion of filter.criteria) {
		switch (criterion.filterType) {
			case FilterType.SearchText: {
				if (criterion.value) {
					const found = searchExtensions(criterion.value);
					results = intersect(results, found);
				}
				break;
			}
			case FilterType.ExtensionName: {
				// Value is "publisher.name"
				if (criterion.value) {
					const [pub, name] = criterion.value.split('.');
					const ext = findExtensionByName(pub, name);
					const found = ext ? [ext] : [];
					results = intersect(results, found);
				}
				break;
			}
			case FilterType.ExtensionId: {
				if (criterion.value) {
					const ext = findExtensionById(criterion.value);
					const found = ext ? [ext] : [];
					results = intersect(results, found);
				}
				break;
			}
			case FilterType.Category: {
				if (criterion.value) {
					const index = loadIndex();
					const cat = criterion.value.toLowerCase();
					const found = index.extensions.filter(
						e => e.categories.some(c => c.toLowerCase() === cat)
					);
					results = intersect(results, found);
				}
				break;
			}
			case FilterType.Tag: {
				if (criterion.value) {
					const index = loadIndex();
					const tag = criterion.value.toLowerCase();
					const found = index.extensions.filter(
						e => e.tags.some(t => t.toLowerCase() === tag)
					);
					results = intersect(results, found);
				}
				break;
			}
			case FilterType.Target:
			case FilterType.ExcludeWithFlags:
			case FilterType.Featured:
				// Ignored for now — we serve all extensions
				break;
		}
	}

	return results ?? loadIndex().extensions;
}

function intersect(existing: ExtensionEntry[] | null, incoming: ExtensionEntry[]): ExtensionEntry[] {
	if (existing === null) {
		return incoming;
	}
	const ids = new Set(incoming.map(e => e.extensionId));
	return existing.filter(e => ids.has(e.extensionId));
}

function toRawExtension(entry: ExtensionEntry, flags: number, baseUrl: string): RawGalleryExtension {
	const versions: RawGalleryVersion[] = entry.versions.map(v => {
		const branch = entry.branch || 'main';
		const assetUri = `${baseUrl}/assets/${entry.publisher.publisherName}/${entry.extensionName}/${branch}/${v.version}`;
		return {
			version: v.version,
			lastUpdated: v.lastUpdated,
			assetUri,
			fallbackAssetUri: assetUri,
			files: (flags & Flag.IncludeFiles) ? v.files.map(f => ({
				assetType: f.assetType,
				source: `${assetUri}/${f.assetType}`,
			})) : [],
			properties: (flags & Flag.IncludeVersionProperties) ? v.properties : [],
			...(v.targetPlatform ? { targetPlatform: v.targetPlatform } : {}),
		};
	});

	return {
		extensionId: entry.extensionId,
		extensionName: entry.extensionName,
		displayName: entry.displayName,
		shortDescription: entry.shortDescription,
		publisher: {
			publisherId: entry.publisher.publisherId,
			publisherName: entry.publisher.publisherName,
			displayName: entry.publisher.displayName,
			domain: null,
			isDomainVerified: false,
		},
		versions: (flags & (Flag.IncludeVersions | Flag.IncludeLatestVersionOnly | Flag.IncludeLatestPrereleaseAndStableVersionOnly)) ? versions : [],
		statistics: (flags & Flag.IncludeStatistics) ? entry.statistics : [],
		tags: (flags & Flag.IncludeCategoryAndTags) ? entry.tags : [],
		categories: (flags & Flag.IncludeCategoryAndTags) ? entry.categories : [],
		releaseDate: entry.releaseDate,
		publishedDate: entry.publishedDate,
		lastUpdated: entry.lastUpdated,
		flags: 'validated',
	};
}
