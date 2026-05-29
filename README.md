# C# Snippet Runner

Obsidian plugin that adds a run button to C# code blocks. It uses CSharpRepl to execute the snippets and displays the output directly in the note.

## Features

- Supports code blocks containing C# code with tags `csharp`, `cs`, `c#`, `net`, `.net` and `dotnet`
- Adds a **Run** button below each block with one of the above tags
- Runs snippets using bundled **CSharpRepl** auto-installed with `dotnet tool` into the plugin folder
- Supports optional script arguments 
- Saves output and arguments per snippet in the plugin `responses` folder
- Restores saved output/arguments when notes are rendered

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Manual installation

Copy these files to:

`<Vault>/.obsidian/plugins/csharp-snippet-runner/`

- `main.js`
- `manifest.json`
- `styles.css`
