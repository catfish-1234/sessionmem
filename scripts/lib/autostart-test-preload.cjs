/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preload must use CommonJS. */
// Test-only OS supervisor. CI validates registrations and runs one real watcher
// sweep, but never installs a login service on a runner's actual account.
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const original = cp.spawnSync;
const statePath = path.join(os.homedir(), 'autostart-test-state.json');
const decode = value => value.replace(/&(amp|lt|gt|quot|apos);/g, part => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[part]);
const readState = () => fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
const save = state => fs.writeFileSync(statePath, JSON.stringify(state));
const result = (stdout = '', status = 0, stderr = '') => ({ status, stdout, stderr, signal: null, pid: 1 });
const sweep = launch => {
  const child = original(launch[0], [...launch.slice(1), '--once'], { encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
  if (child.status !== 0) return result(child.stdout, child.status || 1, child.stderr || String(child.error || 'watch failed'));
  return result();
};
cp.spawnSync = function(command, args, options) {
  const name = path.basename(command).replace(/\.exe$/i, '');
  if (!['systemctl', 'launchctl', 'schtasks', 'whoami'].includes(name)) return original(command, args, options);
  const state = readState();
  if (name === 'whoami') return result('"TEST\\sessionmem","S-1-5-21-1000"\r\n');
  if (name === 'systemctl') {
    if (args[1] === 'is-enabled') return state.enabled ? result('enabled\n') : result('disabled\n', 1);
    if (args[1] === 'enable') state.enabled = true;
    if (args[1] === 'disable') state.enabled = false;
    save(state);
    if (args[1] === 'restart') {
      const unit = fs.readFileSync(path.join(os.homedir(), '.config/systemd/user/sessionmem-watch.service'), 'utf8');
      const exec = unit.match(/^ExecStart=(.+)$/m)[1];
      return sweep([...exec.matchAll(/"(?:\\.|[^"\\])*"/g)].map(m => JSON.parse(m[0]).replace(/%%/g, '%').replace(/\$\$/g, '$')));
    }
  }
  if (name === 'launchctl') {
    if (args[0] === 'print') return state.enabled ? result('running') : result('', 1, 'Could not find service');
    if (args[0] === 'bootout') state.enabled = false;
    if (args[0] === 'bootstrap') {
      state.enabled = true;
      save(state);
      const plist = fs.readFileSync(args[2], 'utf8').match(/<key>ProgramArguments<\/key>\s*<array>(.*?)<\/array>/s)[1];
      return sweep([...plist.matchAll(/<string>(.*?)<\/string>/gs)].map(m => decode(m[1])));
    }
    save(state);
  }
  if (name === 'schtasks') {
    if (args[0] === '/Query') {
      if (args.includes('/XML')) return state.enabled ? result(state.xml) : result('', 0x80070002, 'missing');
      return result(state.enabled ? `"\\${state.name}","N/A","Ready"\r\n` : '');
    }
    if (args[0] === '/Create') {
      state.xml = fs.readFileSync(args[4], 'utf8'); state.name = args[2]; state.enabled = true;
    }
    if (args[0] === '/Delete') state.enabled = false;
    save(state);
    if (args[0] === '/Run') {
      const command = decode(state.xml.match(/<Command>(.*?)<\/Command>/s)[1]);
      const argumentsText = decode(state.xml.match(/<Arguments>(.*?)<\/Arguments>/s)[1]);
      return sweep([command, ...[...argumentsText.matchAll(/"([^"]*)"/g)].map(m => m[1])]);
    }
  }
  return result();
};
require('node:module').syncBuiltinESMExports();
