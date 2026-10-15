import assert from "node:assert";

// lsof port parser matching Rust parse_lsof_ports
function parseLsofPorts(output) {
  const ports = [];
  const seenPorts = new Set();
  const lines = output.split("\n").slice(1);

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;

    const command = parts[0];
    const pid = parseInt(parts[1], 10);
    if (isNaN(pid)) continue;

    const last = parts[parts.length - 1];
    const addrCandidate = last === "(LISTEN)" ? parts[parts.length - 2] : last;

    const colonIdx = addrCandidate.lastIndexOf(":");
    if (colonIdx !== -1) {
      const port = parseInt(addrCandidate.slice(colonIdx + 1), 10);
      if (!isNaN(port) && !seenPorts.has(port)) {
        seenPorts.add(port);
        ports.push({ port, pid, command, address: addrCandidate });
      }
    }
  }

  ports.sort((a, b) => a.port - b.port);
  return ports;
}

const sampleLsof = `COMMAND   PID         USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
rapportd  663 rizkymaulana   13u  IPv4 0x424f07b5406542be      0t0  TCP *:49152 (LISTEN)
rapportd  663 rizkymaulana   14u  IPv6 0x651b3c9719e78b18      0t0  TCP *:49152 (LISTEN)
node    81234 rizkymaulana   22u  IPv4 0x1234567890abcdef      0t0  TCP *:3000 (LISTEN)
bun     92345 rizkymaulana   14u  IPv4 0xabcdef1234567890      0t0  TCP 127.0.0.1:5173 (LISTEN)
`;

const parsed = parseLsofPorts(sampleLsof);
assert.strictEqual(parsed.length, 3);

// Port 3000
assert.strictEqual(parsed[0].port, 3000);
assert.strictEqual(parsed[0].command, "node");
assert.strictEqual(parsed[0].pid, 81234);

// Port 5173
assert.strictEqual(parsed[1].port, 5173);
assert.strictEqual(parsed[1].command, "bun");
assert.strictEqual(parsed[1].pid, 92345);

// Port 49152 (deduplicated between IPv4 and IPv6)
assert.strictEqual(parsed[2].port, 49152);
assert.strictEqual(parsed[2].command, "rapportd");

console.log("Ports scanner parser tests passed!");
