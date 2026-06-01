import { execSync } from 'child_process';
import readline from 'readline';

// root check
try {
  execSync('iptables -L -n', { stdio: 'ignore' });
} catch (e) {
  console.error('\x1b[31m[ERROR] This application requires root privileges to modify iptables.\x1b[0m');
  console.error('\x1b[33mPlease run this command using sudo:\x1b[0m');
  console.error('\x1b[1;37m  sudo npm start\x1b[0m or \x1b[1;37msudo npx ts-node src/index.ts\x1b[0m');
  process.exit(1);
}

let isLagging = false;
const logs: string[] = [];

const C_RESET = '\x1b[0m';
const C_BORDER = '\x1b[38;5;202m';
const C_TITLE = '\x1b[1;38;5;202m';
const C_TEXT = '\x1b[38;5;253m';
const C_DIM = '\x1b[38;5;244m';
const C_ACTIVE = '\x1b[1;38;5;196m';
const C_ACTIVE_BLINK = '\x1b[1;5;38;5;196m';
const C_INACTIVE = '\x1b[1;38;5;82m';
const C_KEY = '\x1b[1;38;5;220m';
const C_INFO = '\x1b[38;5;81m';

// layout
const BOX_WIDTH = 74;
const CONTENT_WIDTH = BOX_WIDTH - 4; // 70
const TOP_BORDER = `${C_BORDER}┌${'─'.repeat(BOX_WIDTH - 2)}┐${C_RESET}`;
const DIVIDER_BORDER = `${C_BORDER}├${'─'.repeat(BOX_WIDTH - 2)}┤${C_RESET}`;
const BOTTOM_BORDER = `${C_BORDER}└${'─'.repeat(BOX_WIDTH - 2)}┘${C_RESET}`;

function getVisualLength(str: string): number {
  const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  return str.replace(ansiRegex, '').length;
}

function truncateVisible(str: string, maxLength: number): string {
  const visualLen = getVisualLength(str);
  if (visualLen <= maxLength) {
    return str;
  }
  let visibleChars = 0;
  let result = '';
  let inEscape = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '\x1b') {
      inEscape = true;
      result += char;
    } else if (inEscape) {
      result += char;
      if (char === 'm') {
        inEscape = false;
      }
    } else {
      if (visibleChars < maxLength - 3) {
        result += char;
        visibleChars++;
      } else {
        result += '...';
        result += C_RESET;
        break;
      }
    }
  }
  return result;
}

function formatLine(content: string): string {
  const truncated = truncateVisible(content, CONTENT_WIDTH);
  const visualLen = getVisualLength(truncated);
  const paddingLength = Math.max(0, CONTENT_WIDTH - visualLen);
  return `${C_BORDER}│${C_RESET} ${truncated}${' '.repeat(paddingLength)} ${C_BORDER}│${C_RESET}`;
}

function formatLineCentered(content: string): string {
  const truncated = truncateVisible(content, CONTENT_WIDTH);
  const visualLen = getVisualLength(truncated);
  const totalPadding = Math.max(0, CONTENT_WIDTH - visualLen);
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;
  return `${C_BORDER}│${C_RESET} ${' '.repeat(leftPadding)}${truncated}${' '.repeat(rightPadding)} ${C_BORDER}│${C_RESET}`;
}

function addLog(msg: string) {
  const time = new Date().toLocaleTimeString();
  logs.push(`${C_DIM}[${time}]${C_RESET} ${msg}`);
  if (logs.length > 5) {
    logs.shift();
  }
}

function cleanup() {
  try {
    execSync('iptables -D INPUT -j LAG_SWITCH 2>/dev/null || true');
    execSync('iptables -D OUTPUT -j LAG_SWITCH 2>/dev/null || true');
    execSync('iptables -F LAG_SWITCH 2>/dev/null || true');
    execSync('iptables -X LAG_SWITCH 2>/dev/null || true');
  } catch (err) {
  }
}

let cleanedUp = false;
function handleExit(code: number = 0) {
  if (!cleanedUp) {
    cleanedUp = true;
    cleanup();
    console.log(`\n${C_INACTIVE}[INFO] Cleaned up iptables rules. Network restored.${C_RESET}`);
  }
  process.exit(code);
}

process.on('SIGINT', () => handleExit(0));
process.on('SIGTERM', () => handleExit(0));
process.on('exit', () => cleanup());
process.on('uncaughtException', (err) => {
  console.error(`\n${C_ACTIVE}[CRITICAL] Uncaught exception:${C_RESET}`, err);
  handleExit(1);
});

function initChain() {
  cleanup();
  try {
    execSync('iptables -N LAG_SWITCH');

    execSync('iptables -A LAG_SWITCH -i lo -j RETURN');
    execSync('iptables -A LAG_SWITCH -o lo -j RETURN');

    const sshConn = process.env.SSH_CONNECTION || process.env.SSH_CLIENT;
    if (sshConn) {
      const parts = sshConn.trim().split(/\s+/);
      if (parts.length >= 4) {
        const clientIp = parts[0];
        const serverPort = parts[3];
        addLog(`${C_INFO}SSH bypass: ${clientIp}:${serverPort}${C_RESET}`);

        execSync(`iptables -A LAG_SWITCH -p tcp --dport ${serverPort} -j RETURN`);
        execSync(`iptables -A LAG_SWITCH -p tcp --sport ${serverPort} -j RETURN`);
      } else {
        addLog(`${C_INFO}SSH bypass: port 22${C_RESET}`);
        execSync('iptables -A LAG_SWITCH -p tcp --dport 22 -j RETURN');
        execSync('iptables -A LAG_SWITCH -p tcp --sport 22 -j RETURN');
      }
    }

    execSync('iptables -A LAG_SWITCH -j DROP');
  } catch (err) {
    console.error(`\x1b[31m[ERROR] Failed to initialize iptables chain:\x1b[0m`, err);
    process.exit(1);
  }
}

function enableLag() {
  try {
    execSync('iptables -I INPUT 1 -j LAG_SWITCH');
    execSync('iptables -I OUTPUT 1 -j LAG_SWITCH');
    isLagging = true;
    addLog(`${C_ACTIVE}Lag Switch enabled (traffic blocked)${C_RESET}`);
  } catch (err) {
    addLog(`${C_ACTIVE}Error enabling lag: ${err}${C_RESET}`);
  }
}

function disableLag() {
  try {
    execSync('iptables -D INPUT -j LAG_SWITCH 2>/dev/null || true');
    execSync('iptables -D OUTPUT -j LAG_SWITCH 2>/dev/null || true');
    isLagging = false;
    addLog(`${C_INACTIVE}Lag Switch disabled (traffic restored)${C_RESET}`);
  } catch (err) {
    addLog(`${C_ACTIVE}Error disabling lag: ${err}${C_RESET}`);
  }
}

function toggleLag() {
  if (isLagging) {
    disableLag();
  } else {
    enableLag();
  }
  renderUI();
}

function renderUI() {
  console.clear();

  const termWidth = process.stdout.columns || BOX_WIDTH;
  const termHeight = process.stdout.rows || 24;

  const boxHeight = 12 + Math.max(1, logs.length);
  const topPaddingAmount = Math.max(0, Math.floor((termHeight - boxHeight) / 2));
  const leftPaddingAmount = Math.max(0, Math.floor((termWidth - BOX_WIDTH) / 2));

  const pad = ' '.repeat(leftPaddingAmount);

  for (let i = 0; i < topPaddingAmount; i++) {
    console.log();
  }

  console.log(pad + TOP_BORDER);
  console.log(pad + formatLineCentered(`${C_TITLE}UBUNTU LAG SWITCH${C_RESET}`));
  console.log(pad + DIVIDER_BORDER);

  if (isLagging) {
    console.log(pad + formatLine(`${C_TEXT}Status:${C_RESET}   ${C_ACTIVE_BLINK}[ ACTIVE ] - no network${C_RESET}`));
  } else {
    console.log(pad + formatLine(`${C_TEXT}Status:${C_RESET}   ${C_INACTIVE}[ INACTIVE ] - normal network${C_RESET}`));
  }

  console.log(pad + DIVIDER_BORDER);
  console.log(pad + formatLine(`${C_TEXT}Controls:${C_RESET} Press ${C_KEY}[SPACE]${C_RESET} or ${C_KEY}[ENTER]${C_RESET} to toggle`));
  console.log(pad + formatLine(`${C_TEXT}Exit:${C_RESET}     Press ${C_ACTIVE}[Ctrl+C]${C_RESET} to quit`));
  console.log(pad + DIVIDER_BORDER);
  console.log(pad + formatLine(`${C_TITLE}Recent Activity:${C_RESET}`));

  if (logs.length === 0) {
    console.log(pad + formatLine(`${C_DIM}No activity yet.${C_RESET}`));
  } else {
    logs.forEach(log => console.log(pad + formatLine(log)));
  }
  console.log(pad + DIVIDER_BORDER);
  console.log(pad + formatLineCentered(`${C_DIM}github.com/vitorwille${C_RESET}`));
  console.log(pad + BOTTOM_BORDER);
}

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

process.stdin.on('keypress', (str, key) => {
  if (key && key.ctrl && key.name === 'c') {
    handleExit(0);
  }
  else if (key && (key.name === 'space' || key.name === 'return')) {
    toggleLag();
  }
});

process.stdin.resume();

if (process.stdout.isTTY) {
  process.stdout.on('resize', () => {
    renderUI();
  });
}

initChain();
addLog('Lag switch initialized.');
renderUI();
