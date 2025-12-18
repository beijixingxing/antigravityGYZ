import * as os from 'os';

const CLI_VERSION = "0.1.5"; // Match current gemini-cli version

export function getUserAgent(): string {
  const system = os.type(); // 'Linux', 'Darwin', 'Windows_NT'
  const arch = os.arch();   // 'x64', 'arm64'
  
  // Node's os.type() returns "Windows_NT" for Windows, "Darwin" for macOS, "Linux" for Linux.
  // Python's platform.system() returns "Windows", "Darwin", "Linux".
  // We should map "Windows_NT" to "Windows" to match Python's output if precise matching is desired,
  // but usually "Windows_NT" is acceptable or even more standard in some contexts.
  // However, gcli2api uses python's platform.system(), so let's try to match that.
  
  let platformName = system;
  if (system === 'Windows_NT') {
      platformName = 'Windows';
  }

  return `GeminiCLI/${CLI_VERSION} (${platformName}; ${arch})`;
}
