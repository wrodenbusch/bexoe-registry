/**
 * VSIX packaging — creates a .vsix file (ZIP with VS Code extension structure).
 */

import { createWriteStream, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import yazl from 'yazl';

export interface VsixOptions {
	/** Directory containing the built extension (package.json, out/, README.md, etc.) */
	sourceDir: string;
	/** Output path for the .vsix file */
	outputPath: string;
	/** Extension publisher */
	publisher: string;
	/** Extension name */
	name: string;
	/** Extension version */
	version: string;
}

/**
 * Packages an extension directory into a .vsix file.
 */
export async function createVsix(opts: VsixOptions): Promise<void> {
	const { sourceDir, outputPath, publisher, name, version } = opts;

	const packageJsonPath = join(sourceDir, 'package.json');
	if (!existsSync(packageJsonPath)) {
		throw new Error(`package.json not found at ${packageJsonPath}`);
	}
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

	const zip = new yazl.ZipFile();

	// [Content_Types].xml
	zip.addBuffer(Buffer.from(buildContentTypes()), '[Content_Types].xml');

	// extension.vsixmanifest
	zip.addBuffer(
		Buffer.from(buildVsixManifest({ publisher, name, version, displayName: packageJson.displayName || name, description: packageJson.description || '' })),
		'extension.vsixmanifest',
	);

	// Add extension files under extension/ prefix
	addDirectoryToZip(zip, sourceDir, 'extension');

	// Write the zip
	return new Promise((resolve, reject) => {
		zip.outputStream.pipe(createWriteStream(outputPath))
			.on('close', resolve)
			.on('error', reject);
		zip.end();
	});
}

function addDirectoryToZip(zip: yazl.ZipFile, dir: string, prefix: string): void {
	const entries = readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		const zipPath = `${prefix}/${entry.name}`;

		// Skip directories we don't want in the VSIX
		if (entry.name === 'node_modules' || entry.name === 'src' || entry.name === '.git') {
			continue;
		}

		if (entry.isDirectory()) {
			addDirectoryToZip(zip, fullPath, zipPath);
		} else {
			zip.addFile(fullPath, zipPath);
		}
	}
}

function buildContentTypes(): string {
	return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
	<Default Extension=".json" ContentType="application/json" />
	<Default Extension=".js" ContentType="application/javascript" />
	<Default Extension=".js.map" ContentType="application/json" />
	<Default Extension=".md" ContentType="text/markdown" />
	<Default Extension=".png" ContentType="image/png" />
	<Default Extension=".txt" ContentType="text/plain" />
	<Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>`;
}

function buildVsixManifest(opts: { publisher: string; name: string; version: string; displayName: string; description: string }): string {
	const id = `${opts.publisher}.${opts.name}`;
	return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
	<Metadata>
		<Identity Language="en-US" Id="${id}" Version="${opts.version}" Publisher="${opts.publisher}" />
		<DisplayName>${escapeXml(opts.displayName)}</DisplayName>
		<Description xml:space="preserve">${escapeXml(opts.description)}</Description>
		<Tags>bexoe</Tags>
		<Categories>Other</Categories>
		<GalleryFlags>Public</GalleryFlags>
		<Properties>
			<Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.100.0" />
			<Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
		</Properties>
	</Metadata>
	<Installation>
		<InstallationTarget Id="Microsoft.VisualStudio.Code" />
	</Installation>
	<Dependencies />
	<Assets>
		<Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
	</Assets>
</PackageManifest>`;
}

function escapeXml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
