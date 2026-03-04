// VS Code Gallery Wire Format Types

export interface ExtensionQueryRequest {
	filters: QueryFilter[];
	assetTypes: string[];
	flags: number;
}

export interface QueryFilter {
	criteria: FilterCriterion[];
	pageNumber: number;
	pageSize: number;
	sortBy: number;
	sortOrder: number;
}

export interface FilterCriterion {
	filterType: number;
	value?: string;
}

// Filter type numeric values (from extensionGalleryManifest.ts)
export const FilterType = {
	Tag: 1,
	ExtensionId: 4,
	Category: 5,
	ExtensionName: 7,
	Target: 8,
	Featured: 9,
	SearchText: 10,
	ExcludeWithFlags: 12,
} as const;

// Sort options
export const SortBy = {
	NoneOrRelevance: 0,
	LastUpdatedDate: 1,
	Title: 2,
	PublisherName: 3,
	InstallCount: 4,
	AverageRating: 6,
	PublishedDate: 10,
	WeightedRating: 12,
} as const;

export const SortOrder = {
	Default: 0,
	Ascending: 1,
	Descending: 2,
} as const;

// Flag bitmask values
export const Flag = {
	None: 0x0,
	IncludeVersions: 0x1,
	IncludeFiles: 0x2,
	IncludeCategoryAndTags: 0x4,
	IncludeSharedAccounts: 0x8,
	IncludeVersionProperties: 0x10,
	ExcludeNonValidated: 0x20,
	IncludeInstallationTargets: 0x40,
	IncludeAssetUri: 0x80,
	IncludeStatistics: 0x100,
	IncludeLatestVersionOnly: 0x200,
	Unpublished: 0x1000,
	IncludeNameConflictInfo: 0x8000,
	IncludeLatestPrereleaseAndStableVersionOnly: 0x10000,
} as const;

// Asset type constants
export const AssetType = {
	Icon: 'Microsoft.VisualStudio.Services.Icons.Default',
	Details: 'Microsoft.VisualStudio.Services.Content.Details',
	Changelog: 'Microsoft.VisualStudio.Services.Content.Changelog',
	Manifest: 'Microsoft.VisualStudio.Code.Manifest',
	VSIX: 'Microsoft.VisualStudio.Services.VSIXPackage',
	License: 'Microsoft.VisualStudio.Services.Content.License',
	Repository: 'Microsoft.VisualStudio.Services.Links.Source',
	Signature: 'Microsoft.VisualStudio.Services.VsixSignature',
} as const;

// Property type constants
export const PropertyType = {
	Dependency: 'Microsoft.VisualStudio.Code.ExtensionDependencies',
	ExtensionPack: 'Microsoft.VisualStudio.Code.ExtensionPack',
	Engine: 'Microsoft.VisualStudio.Code.Engine',
	PreRelease: 'Microsoft.VisualStudio.Code.PreRelease',
	LocalizedLanguages: 'Microsoft.VisualStudio.Code.LocalizedLanguages',
	WebExtension: 'Microsoft.VisualStudio.Code.WebExtension',
	SponsorLink: 'Microsoft.VisualStudio.Code.SponsorLink',
	ExecutesCode: 'Microsoft.VisualStudio.Code.ExecutesCode',
} as const;

// Extension metadata stored in index.json
export interface ExtensionEntry {
	extensionId: string;
	publisher: {
		publisherId: string;
		publisherName: string;
		displayName: string;
	};
	extensionName: string;
	displayName: string;
	shortDescription: string;
	categories: string[];
	tags: string[];
	versions: ExtensionVersion[];
	statistics: ExtensionStatistic[];
	releaseDate: string;
	publishedDate: string;
	lastUpdated: string;
	// Bexoe ecosystem fields
	branch?: string;
	parentBranch?: string;
	generatedBy?: 'claude-code' | 'manual';
	generationPrompt?: string;
}

// Request body for POST /api/generate
export interface GenerateRequest {
	message: string;
	extensionName?: string;
	branch?: string;
}

// SSE event types for generation progress
export interface GenerateEvent {
	type: 'progress' | 'complete' | 'existing' | 'error';
	message: string;
	extensionId?: string;
	extensionName?: string;
	branch?: string;
	version?: string;
}

export interface ExtensionVersion {
	version: string;
	lastUpdated: string;
	targetPlatform?: string;
	files: ExtensionFile[];
	properties: ExtensionProperty[];
}

export interface ExtensionFile {
	assetType: string;
	source: string;
}

export interface ExtensionProperty {
	key: string;
	value: string;
}

export interface ExtensionStatistic {
	statisticName: string;
	value: number;
}

// Index file shape
export interface ExtensionIndex {
	extensions: ExtensionEntry[];
}

// Query response types
export interface QueryResult {
	results: [{
		extensions: RawGalleryExtension[];
		resultMetadata: [{
			metadataType: 'ResultCount';
			metadataItems: [{ name: 'TotalCount'; count: number }];
		}];
	}];
}

export interface RawGalleryExtension {
	extensionId: string;
	extensionName: string;
	displayName: string;
	shortDescription: string;
	publisher: {
		publisherId: string;
		publisherName: string;
		displayName: string;
		domain: string | null;
		isDomainVerified: boolean;
	};
	versions: RawGalleryVersion[];
	statistics: ExtensionStatistic[];
	tags: string[];
	categories: string[];
	releaseDate: string;
	publishedDate: string;
	lastUpdated: string;
	flags: string;
}

export interface RawGalleryVersion {
	version: string;
	lastUpdated: string;
	assetUri: string;
	fallbackAssetUri: string;
	files: ExtensionFile[];
	properties: ExtensionProperty[];
	targetPlatform?: string;
}
