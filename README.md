# CSharp Snippet Runner

Obsidian plugin that adds a run button to C# code blocks. It uses [CSharpRepl](https://github.com/waf/CSharpRepl) to execute the snippets and displays the output directly in the note.

<img width="960" height="487" alt="Schermafbeelding 2026-05-29 110157" src="https://github.com/user-attachments/assets/233e5535-0cf4-4c75-ba27-8af9a36315ec" />


## Features

- Supports code blocks containing C# code with tags `csharp`, `cs`, `c#`, `net`, `.net` and `dotnet`
- Adds a **Run** button below each block with one of the above tags
- Runs snippets using bundled **CSharpRepl** auto-installed with `dotnet tool` into the plugin folder
- Supports optional script arguments 
- Saves output and arguments per snippet in the plugin `responses` folder
- Restores saved output/arguments when notes are rendered

## Requirements
- Obsidian version >= 1.12.7
- [dotnet SDK](https://dotnet.microsoft.com/en-us/download) installed on your PC

## Usage
- Add a code snippet to your Obsidian note with one of these tags: `csharp`, `cs`, `c#`, `net`, `.net` or `dotnet`
- Optionally enter args
- Click `Run C#`

See [CSharpRepl](https://github.com/waf/CSharpRepl) on how to use with includes and nuget packages

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
