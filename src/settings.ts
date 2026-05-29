import { App, PluginSettingTab, Setting } from 'obsidian';
import CSharpSnippetRunnerPlugin from './main';

export interface CSharpSnippetSettings {
	executionTimeoutMs: number;
}

export const DEFAULT_SETTINGS: CSharpSnippetSettings = {
	executionTimeoutMs: 3000,
};

export class CSharpSnippetSettingTab extends PluginSettingTab {
   plugin: CSharpSnippetRunnerPlugin;

   constructor(app: App, plugin: CSharpSnippetRunnerPlugin) {
		super(app, plugin);
        this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
           .setName('C# snippet runner')
         .setDesc('Code blocks tagged with cs, csharp, or c# include a run snippet button in preview mode.');

		new Setting(containerEl)
          .setName('Execution timeout (ms)')
          .setDesc('Maximum time to wait before stopping execution and returning captured output.')
			.addText((text) => text
				.setPlaceholder('3000')
				.setValue(String(this.plugin.settings.executionTimeoutMs))
				.onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					if (Number.isFinite(parsed) && parsed > 0) {
						this.plugin.settings.executionTimeoutMs = parsed;
						await this.plugin.saveSettings();
					}
				}));
	}
}
