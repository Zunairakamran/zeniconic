import { spawn } from 'node:child_process';

/** Result of one fully-drained child process. */
export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Every process spawn in Zeniconic funnels through this seam. Tests inject a
 * fake so no suite ever shells out; production uses {@link nodeRunner}.
 */
export interface Runner {
  run(bin: string, args: string[]): Promise<RunResult>;
}

/**
 * Default runner: spawns `bin` without a shell, drains stdout/stderr as UTF-8
 * and resolves with the exit code. A spawn failure rejects.
 */
export const nodeRunner: Runner = {
  run(bin: string, args: string[]): Promise<RunResult> {
    return new Promise<RunResult>((resolve, reject) => {
      const child = spawn(bin, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.once('error', (error: Error) => {
        reject(
          new Error(
            `Failed to start "${bin}". Check that the binary exists and is executable.`,
            { cause: error },
          ),
        );
      });

      child.once('close', (code: number | null) => {
        resolve({ code: code ?? -1, stdout, stderr });
      });
    });
  },
};
