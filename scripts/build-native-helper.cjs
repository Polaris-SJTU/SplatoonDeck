const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const windowsRoot = process.env.SystemRoot || 'C:\\Windows';
const candidates = [
  path.join(windowsRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  path.join(windowsRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
];
const compiler = candidates.find((candidate) => fs.existsSync(candidate));
if (!compiler) {
  console.error('The Windows .NET Framework C# compiler was not found. Windows 11 with .NET Framework 4.8 is required.');
  process.exit(1);
}

const projectRoot = path.join(__dirname, '..');
const source = path.join(projectRoot, 'native', 'SplatoonDeck.Setup', 'Program.cs');
const outputDirectory = path.join(projectRoot, 'native', 'bin');
const output = path.join(outputDirectory, 'SplatoonDeck.Setup.exe');
const icon = path.join(projectRoot, 'build', 'icon.ico');
fs.mkdirSync(outputDirectory, { recursive: true });

const result = spawnSync(compiler, [
  '/nologo',
  '/target:winexe',
  '/platform:x64',
  '/optimize+',
  `/out:${output}`,
  `/win32icon:${icon}`,
  '/reference:System.Management.dll',
  '/reference:System.Web.Extensions.dll',
  source
], { stdio: 'inherit', windowsHide: true });

if (result.error) throw result.error;
process.exit(result.status ?? 1);
