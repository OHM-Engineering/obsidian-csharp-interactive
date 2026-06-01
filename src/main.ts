import { FileSystemAdapter, loadPrism, MarkdownPostProcessorContext, Notice, Platform, Plugin } from 'obsidian';
import { CSharpSnippetSettingTab, CSharpSnippetSettings, DEFAULT_SETTINGS } from './settings';

interface NodeChildProcess {
	stdout: { on: (event: 'data', cb: (chunk: unknown) => void) => void };
	stderr: { on: (event: 'data', cb: (chunk: unknown) => void) => void };
	stdin: { write: (chunk: string) => void; end: () => void };
	on: (event: 'error' | 'close', cb: (value: unknown) => void) => void;
	kill: () => void;
}

interface NodeChildProcessModule {
	spawn: (command: string, argv: string[], options: { windowsHide: boolean; stdio: string[] }) => NodeChildProcess;
}

interface NodeFsModule {
	existsSync: (path: string) => boolean;
}

interface NodeFsPromisesModule {
	mkdir: (targetPath: string, options: { recursive: boolean }) => Promise<void>;
}

const LOG_PREFIX = '[csharp-snippet-runner]';
const RESPONSES_FOLDER_NAME = 'responses';
const RUNTIME_FOLDER_NAME = 'runtime';
const REPL_TOOL_FOLDER_NAME = 'csharprepl';

interface ReplExecutionError extends Error {
	code?: number | string;
	stdout?: string;
	stderr?: string;
}

export default class CSharpSnippetRunnerPlugin extends Plugin {
	settings: CSharpSnippetSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CSharpSnippetSettingTab(this.app, this));

		// We want to support multiple tags for C# code blocks, which is why we register multiple processors
		this.registerMarkdownCodeBlockProcessor('csharp', async (source, element, context) => {
			await this.renderRunnableSnippet(source, element, context);
		});

		this.registerMarkdownCodeBlockProcessor('cs', async (source, element, context) => {
			await this.renderRunnableSnippet(source, element, context);
		});

		this.registerMarkdownCodeBlockProcessor('c#', async (source, element, context) => {
			await this.renderRunnableSnippet(source, element, context);
		});

		this.registerMarkdownCodeBlockProcessor('.net', async (source, element, context) => {
			await this.renderRunnableSnippet(source, element, context);
		});

		this.registerMarkdownCodeBlockProcessor('net', async (source, element, context) => {
			await this.renderRunnableSnippet(source, element, context);
		});


		this.registerMarkdownCodeBlockProcessor('dotnet', async (source, element, context) => {
			await this.renderRunnableSnippet(source, element, context);
		});
	}

	// Settings are used to specify the timeout for running snippets
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<CSharpSnippetSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// This function adds all of our custom UI elements to the code snippet block
	private async renderRunnableSnippet(source: string, element: HTMLElement, context: MarkdownPostProcessorContext): Promise<void> {
		const codeElement = document.createElement('pre');
		codeElement.addClass('language-csharp');
		const codeInner = document.createElement('code');
		codeInner.addClass('language-csharp');
		codeInner.textContent = source;
		codeElement.appendChild(codeInner);
		await this.highlightCode(codeInner);

		const runnerContainer = document.createElement('div');
		runnerContainer.className = 'csharp-runner-container';

		const runButton = document.createElement('button');
		runButton.className = 'csharp-runner-button';
		runButton.textContent = 'Run snippet';

		const argsElement = document.createElement('textarea');
		argsElement.className = 'csharp-runner-input';
		argsElement.placeholder = 'Optional script args. Access them using the args array.';

		const argsDetails = document.createElement('details');
		argsDetails.className = 'csharp-runner-details';
		const argsSummary = document.createElement('summary');
		argsSummary.textContent = 'Arguments';
		argsDetails.appendChild(argsSummary);
		argsDetails.appendChild(argsElement);

		// Output element is hidden until we have something to display
		const outputElement = document.createElement('pre');
		outputElement.className = 'csharp-runner-output';
		outputElement.hidden = true;

		const responseOutputPath = await this.getBlockResponseOutputPath(source, context, element);
		const responseArgsPath = responseOutputPath
			? this.getBlockArgsPathFromOutputPath(responseOutputPath)
			: null;

		// We store the args that are used so they are persisted when the note is closed and reopened
		if (responseArgsPath) {
			const existingArgs = await this.readSavedResponse(responseArgsPath);
			if (existingArgs !== null) {
				argsElement.value = existingArgs;
			}

			// Save args on input with a debounce to avoid excessive writes
			let argsSaveTimeout: number | null = null;
			argsElement.addEventListener('input', () => {
				if (argsSaveTimeout !== null) {
					window.clearTimeout(argsSaveTimeout);
				}

				argsSaveTimeout = window.setTimeout(() => {
					void this.saveResponse(responseArgsPath, argsElement.value);
				}, 250);
			});
		}

		// We'll show any previously aquired output when the snippet is rendered
		if (responseOutputPath) {
			const existingOutput = await this.readSavedResponse(responseOutputPath);
			if (existingOutput !== null) {
				outputElement.hidden = false;
				outputElement.textContent = existingOutput;
			}
		}

		// The main event handler for running the snippet when the button is clicked
		runButton.addEventListener('click', () => {
			void this.runSnippet(source, argsElement, outputElement, responseOutputPath, responseArgsPath, runButton);
		});

		element.appendChild(codeElement);
		runnerContainer.appendChild(argsDetails);
		runnerContainer.appendChild(runButton);
		runnerContainer.appendChild(outputElement);
		element.appendChild(runnerContainer);
	}

	// This function handles the UI state when running a snippet
	private async runSnippet(
		source: string,
		argsElement: HTMLTextAreaElement,
		outputElement: HTMLElement,
		responseOutputPath: string | null,
		responseArgsPath: string | null,
		runButton: HTMLButtonElement,
	): Promise<void> {
		runButton.disabled = true;
		argsElement.disabled = true;
		runButton.textContent = 'Running...';
		outputElement.hidden = false;
		outputElement.textContent = 'Running snippet...';

		// We run the snippet in a try/finally to ensure the UI is re-enabled even if execution fails
		try {
			const result = await this.executeSnippet(source, argsElement.value);
			outputElement.textContent = result;
			if (responseOutputPath) {
				await this.saveResponse(responseOutputPath, result);
			}
			if (responseArgsPath) {
				await this.saveResponse(responseArgsPath, argsElement.value);
			}
		} finally {
			runButton.disabled = false;
			argsElement.disabled = false;
			runButton.textContent = 'Run snippet';
		}
	}

	// This function prepares the snippet and arguments for execution
	private async executeSnippet(snippet: string, argsInput: string): Promise<string> {
		if (!Platform.isDesktopApp) {
			return 'Running snippets is only supported in desktop Obsidian.';
		}

		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			return 'Vault filesystem is unavailable. Cannot run C# snippets.';
		}

		const basePath = adapter.getBasePath();
		console.debug(`${LOG_PREFIX} Vault base path:`, basePath);

		let replPath: string;
		try {
			replPath = await this.resolveCSharpReplPath(adapter);
			console.debug(`${LOG_PREFIX} Using CSharpRepl executable:`, replPath);
		} catch {
			return [
				'Could not prepare CSharpRepl.',
				'Make sure .NET SDK is installed and available as dotnet.',
				'Check console logs for install errors.'
			].join('\n');
		}

		// Parsing args is quite simple. Space is a seperator and we guard agains whitespace
		// This does have the downside that we don't support args with spaces.
		const scriptArgs = argsInput.split(' ')
			.map((value) => value.trim())
			.filter((value) => value.length > 0);

		const scriptContent = this.buildScript(snippet, scriptArgs);
		const replArgs = ['--streamPipedInput'];
		console.debug(`${LOG_PREFIX} Running CSharpRepl with piped script input.`);
		console.debug(`${LOG_PREFIX} CSharpRepl args:`, replArgs);
		console.debug(`${LOG_PREFIX} Parsed script arg count:`, scriptArgs.length);

		try {
			const { stdout, stderr } = await this.runRepl(replPath, replArgs, scriptContent);

			const output = [stdout, stderr].filter(Boolean).join('\n').trim();
			console.debug(`${LOG_PREFIX} Snippet execution completed.`);
			return output.length > 0 ? output : '(No output)';
		} catch (error: unknown) {
			const executionError = error as ReplExecutionError;
			if (executionError.code === 'ENOENT') {
				return 'CSharpRepl executable is missing. Ensure dotnet tool install completed successfully.';
			}
			const output = [executionError.stdout, executionError.stderr, executionError.message]
				.filter(Boolean)
				.join('\n')
				.trim();

			console.error(`${LOG_PREFIX} Snippet execution failed:`, executionError);

			new Notice('C# snippet execution failed.');
			return output.length > 0 ? output : 'Snippet execution failed.';
		}
	}

	// The function that calls CSharpRepl and captures the output
	private runRepl(replPath: string, args: string[], scriptContent: string): Promise<{ stdout: string; stderr: string }> {
		return new Promise((resolve, reject) => {
			const childProcess = this.getDesktopNodeModule<NodeChildProcessModule>('child_process');
			const child = childProcess.spawn(replPath, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
			let stdout = '';
			let stderr = '';
			let timedOut = false;

			// Make sure we kill the process if it exceeds the specified timeout
			const timeoutMs = this.settings.executionTimeoutMs;
			const timeoutHandle = setTimeout(() => {
				timedOut = true;
				console.debug(`${LOG_PREFIX} CSharpRepl timeout (${timeoutMs}ms) reached; terminating process.`);
				child.kill();
			}, timeoutMs);

			// Capture the output
			child.stdout.on('data', (chunk: unknown) => {
				stdout += String(chunk);
			});

			child.stderr.on('data', (chunk: unknown) => {
				stderr += String(chunk);
			});

			child.on('error', (error) => {
				reject(error instanceof Error ? error : new Error(String(error)));
			});

			// Handle exit based on exit code/timeout
			child.on('close', (codeValue) => {
				const code = typeof codeValue === 'number' ? codeValue : -1;
				clearTimeout(timeoutHandle);

				if (timedOut) {
                    const timeoutError = new Error(`CSharpRepl execution timed out after ${timeoutMs}ms. Increase the timeout setting and try again.`) as ReplExecutionError;
					timeoutError.code = 'ETIMEDOUT';
					timeoutError.stdout = stdout;
					timeoutError.stderr = stderr;
					reject(timeoutError);
					return;
				}

				if (code === 0) {
					resolve({ stdout, stderr });
					return;
				}

				const executionError = new Error(`CSharpRepl exited with code ${String(code)}`) as ReplExecutionError;
				executionError.code = code ?? undefined;
				executionError.stdout = stdout;
				executionError.stderr = stderr;
				reject(executionError);
			});

			child.stdin.write(scriptContent);

			// CSharpRepl expects a newline at the end of the script
			if (!scriptContent.endsWith('\n')) {
				child.stdin.write('\n');
			}
			child.stdin.end();

		});
	}

	// While testing I found that passing args as specified by CSharpRepl (using -- as seperator) did not work
	// We'll manually add the args by creating a new array ourselves and prepending it to the snippet
	private buildScript(snippet: string, scriptArgs: string[]): string {
		if (scriptArgs.length === 0) {
			return snippet;
		}

		const argsBootstrap = `args = new string[] { ${scriptArgs
			.map((item) => JSON.stringify(item))
			.join(', ')} };`;

		return [argsBootstrap, snippet].join('\n');
	}

	// This function checks if CSharpRepl is installed. If not we install it using dotnet tool install and return the path
	private async resolveCSharpReplPath(adapter: FileSystemAdapter): Promise<string> {
		const toolPath = this.getBundledReplToolPath(adapter);
		const executablePath = this.getToolExecutablePath(toolPath);
		if (await this.pathExists(executablePath)) {
			return executablePath;
		}

		const fsPromises = this.getDesktopNodeModule<NodeFsPromisesModule>('fs/promises');
		await fsPromises.mkdir(toolPath, { recursive: true });
		console.debug(`${LOG_PREFIX} Installing CSharpRepl into:`, toolPath);

		await new Promise<void>((resolve, reject) => {
			const childProcess = this.getDesktopNodeModule<NodeChildProcessModule>('child_process');
			const child = childProcess.spawn('dotnet', ['tool', 'install', 'csharprepl', '--tool-path', toolPath], {
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'pipe']
			});
			let stderr = '';

			child.stdout.on('data', () => undefined);
			child.stderr.on('data', (chunk: unknown) => {
				stderr += String(chunk);
			});

			child.on('error', (error) => {
				reject(error instanceof Error ? error : new Error(String(error)));
			});

			child.on('close', (codeValue: unknown) => {
				const code = typeof codeValue === 'number' ? codeValue : -1;
				if (code === 0) {
					resolve();
					return;
				}

				reject(new Error(stderr.trim() || `dotnet exited with code ${code}`));
			});
		});

		if (await this.pathExists(executablePath)) {
			return executablePath;
		}

		throw new Error('Bundled CSharpRepl not found after installation');
	}

	private async pathExists(filePath: string): Promise<boolean> {
		try {
			const fs = this.getDesktopNodeModule<NodeFsModule>('fs');
			return fs.existsSync(filePath);
		} catch {
			return false;
		}
	}

	// Using the snippet's hash, we can create a unique path for the snippet's output
	private async getBlockResponseOutputPath(source: string, context: MarkdownPostProcessorContext, element: HTMLElement): Promise<string | null> {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			return null;
		}

		const responsesFolder = this.joinVaultPath(this.app.vault.configDir, 'plugins', this.manifest.id, RESPONSES_FOLDER_NAME);
		if (!(await adapter.exists(responsesFolder))) {
			await adapter.mkdir(responsesFolder);
		}

		const sourcePath = typeof context?.sourcePath === 'string' ? context.sourcePath : 'unknown';
		const lineStart = typeof context?.getSectionInfo === 'function'
			? context.getSectionInfo(element)?.lineStart ?? -1
			: -1;
		const id = await this.hashText(`${sourcePath}:${lineStart}:${source}`);

		return this.joinVaultPath(responsesFolder, `${id}.txt`);
	}


	private async readSavedResponse(responsePath: string): Promise<string | null> {
		const adapter = this.app.vault.adapter;
		try {
			return await adapter.read(responsePath);
		} catch {
			return null;
		}
	}

	private async saveResponse(responsePath: string, value: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		try {
			await adapter.write(responsePath, value);
			console.debug(`${LOG_PREFIX} Saved response output:`, responsePath);
		} catch (error) {
			console.error(`${LOG_PREFIX} Failed to save response output:`, error);
		}
	}

	private getBlockArgsPathFromOutputPath(outputPath: string): string {
		return outputPath.endsWith('.txt')
			? `${outputPath.slice(0, -4)}.args.txt`
			: `${outputPath}.args.txt`;
	}

	// Use Prism to highlight the code block like Obsidian does. 
	// We need to do this manually since we're basically replacing the code block with our own version.
	private async highlightCode(codeElement: HTMLElement): Promise<void> {
		try {
			const prism = await loadPrism() as { highlightElement?: (element: HTMLElement) => void };
			if (typeof prism.highlightElement === 'function') {
				prism.highlightElement(codeElement);
			}
		} catch (error) {
			console.warn(`${LOG_PREFIX} Failed to highlight code block:`, error);
		}
	}

	private getBundledReplToolPath(adapter: FileSystemAdapter): string {
		return this.joinSystemPath(adapter.getBasePath(), this.app.vault.configDir, 'plugins', this.manifest.id, RUNTIME_FOLDER_NAME, REPL_TOOL_FOLDER_NAME);
	}

	private getToolExecutablePath(toolPath: string): string {
		return Platform.isWin
			? this.joinSystemPath(toolPath, 'csharprepl.exe')
			: this.joinSystemPath(toolPath, 'csharprepl');
	}

	// Guard against environments where Node require is not available
	private getDesktopNodeModule<TModule>(moduleName: string): TModule {
		if (!Platform.isDesktopApp) {
			throw new Error('Node modules are only available on desktop.');
		}

		const electronWindow = window as Window & { require?: (moduleName: string) => unknown };
		if (typeof electronWindow.require !== 'function') {
			throw new Error('Node require is unavailable in this environment.');
		}

		return electronWindow.require(moduleName) as TModule;
	}

	private joinVaultPath(...parts: string[]): string {
      // Vault adapter paths are POSIX-style (forward slashes), regardless of OS.
		// Normalize all separators and collapse duplicate slashes.
		return parts.filter(Boolean).join('/').replace(/\/+/g, '/').replace(/\/\//g, '/');
	}

	private joinSystemPath(...parts: string[]): string {
      // Runtime executable paths are OS-native filesystem paths.
		// Use '\\' on Windows and '/' elsewhere, then normalize mixed separators.
		const separator = Platform.isWin ? '\\' : '/';
		return parts
			.filter(Boolean)
			.join(separator)
			.replace(/[\\/]+/g, separator);
	}

	private async hashText(value: string): Promise<string> {
		const encoded = new TextEncoder().encode(value);
		const digest = await crypto.subtle.digest('SHA-256', encoded);
		return Array.from(new Uint8Array(digest))
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('');
	}
}
