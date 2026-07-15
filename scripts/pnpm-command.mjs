/**
 * Compose a shell-free pnpm child-process command on POSIX and the equivalent
 * cmd.exe invocation required for Corepack's pnpm.cmd shim on Windows.
 *
 * Arguments are repository-owned release/build inputs. Quote every argument
 * on Windows so paths with spaces and cmd metacharacters stay one argument.
 */
export function composePnpmCommand(commandArgs, options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  if (platform !== 'win32') {
    return { command: 'pnpm', args: [...commandArgs] }
  }

  const commandLine = ['pnpm.cmd', ...commandArgs.map(quoteCmdArgument)].join(' ')
  return {
    command: env.ComSpec ?? env.COMSPEC ?? 'cmd.exe',
    args: ['/d', '/s', '/c', commandLine],
  }
}

function quoteCmdArgument(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}
