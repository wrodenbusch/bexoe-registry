/**
 * System prompt template for extension generation via Claude Code.
 */

export function buildGenerationPrompt(opts: {
	message: string;
	existingSource?: string;
	extensionName?: string;
}): string {
	const lines: string[] = [];

	lines.push(`You are generating a VS Code extension for Bexoe, a knowledge-work editor.`);
	lines.push(``);
	lines.push(`## Requirements`);
	lines.push(``);
	lines.push(`User request: ${opts.message}`);
	lines.push(``);

	if (opts.existingSource) {
		lines.push(`## Existing source code to adapt`);
		lines.push(``);
		lines.push(`This is a branch from an existing extension. Modify the code below to match the user's request. Keep what works, change what needs to change.`);
		lines.push(``);
		lines.push('```typescript');
		lines.push(opts.existingSource);
		lines.push('```');
		lines.push(``);
	}

	lines.push(`## Instructions`);
	lines.push(``);
	lines.push(`1. Create \`package.json\` with this structure:`);
	lines.push(`   - name: "bexoe-{extension-name}" (lowercase, hyphens)`);
	lines.push(`   - version: "0.1.0"`);
	lines.push(`   - publisher: "bexoe"`);
	lines.push(`   - engines: { "vscode": "^1.100.0" }`);
	lines.push(`   - categories: ["Other"]`);
	lines.push(`   - main: "./out/extension.js"`);
	lines.push(`   - activationEvents: ["onStartupFinished"]`);
	lines.push(`   - contributes: register commands as "bexoe.{name}.{action}"`);
	lines.push(``);
	lines.push(`2. Create \`src/extension.ts\` with:`);
	lines.push(`   - \`import * as vscode from 'vscode';\``);
	lines.push(`   - \`export function activate(context: vscode.ExtensionContext)\``);
	lines.push(`   - \`export function deactivate()\``);
	lines.push(`   - Use \`context.subscriptions.push()\` for disposables`);
	lines.push(`   - Use vscode API for UI (StatusBarItem, commands, webview panels, etc.)`);
	lines.push(``);
	lines.push(`3. Build the extension:`);
	lines.push(`   \`\`\``);
	lines.push(`   npx esbuild src/extension.ts --bundle --outfile=out/extension.js --external:vscode --format=cjs --platform=node`);
	lines.push(`   \`\`\``);
	lines.push(``);
	lines.push(`4. If the build fails, fix the errors and rebuild.`);
	lines.push(``);
	lines.push(`5. Create a brief \`README.md\` describing the extension.`);
	lines.push(``);
	lines.push(`Keep the extension focused and simple. Prefer vscode built-in APIs over external dependencies.`);

	return lines.join('\n');
}

/**
 * Derive a kebab-case extension name from a user's description.
 */
export function deriveExtensionName(message: string): string {
	return message
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, '')
		.trim()
		.split(/\s+/)
		.slice(0, 4)
		.join('-')
		|| 'custom-extension';
}
