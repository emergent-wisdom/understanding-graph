import { spawnSync } from 'node:child_process';

// Production dependency audit with one reviewed exception.
//
// GHSA-6qxp-vccf-f47h affects the MCP SDK's OAuth client, which can send
// credentials to an authorization server the MCP server chooses. Understanding
// Graph uses the SDK only as a server: shipped code imports
// @modelcontextprotocol/sdk/server/index.js, server/stdio.js and types.js, never
// the client or shared/auth modules. The SDK stays pinned at 1.30.0 for 0.1.32
// so that release matches the code a reading run was made on. Remove this
// exception when the pin moves to 1.31.0 or later.
//
// Every other advisory fails, and so does any audit error or unreadable report.
const ALLOWED = {
  package: '@modelcontextprotocol/sdk',
  advisory: 'https://github.com/advisories/GHSA-6qxp-vccf-f47h',
};

const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error('npm audit did not return a readable report.');
  console.error(result.stderr || result.stdout);
  process.exit(1);
}

if (
  report.error ||
  report.auditReportVersion !== 2 ||
  !report.vulnerabilities
) {
  console.error('npm audit failed:');
  console.error(JSON.stringify(report.error ?? report, null, 2));
  process.exit(1);
}

const isAllowed = (name, vulnerability) =>
  name === ALLOWED.package &&
  vulnerability.via.length > 0 &&
  vulnerability.via.every(
    (via) => typeof via === 'object' && via.url === ALLOWED.advisory,
  );

const blocking = [];
let allowedSeen = false;
for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
  if (isAllowed(name, vulnerability)) {
    allowedSeen = true;
    continue;
  }
  const advisories = vulnerability.via.map((via) =>
    typeof via === 'string' ? `via ${via}` : `${via.url} ${via.title}`,
  );
  blocking.push(
    `${name} (${vulnerability.severity}): ${advisories.join('; ')}`,
  );
}

if (blocking.length > 0) {
  console.error(
    `Production dependency audit found ${blocking.length} vulnerable packages:`,
  );
  for (const line of blocking) console.error(`  ${line}`);
  process.exit(1);
}

if (allowedSeen) {
  console.log(
    `Production dependency audit passed with one reviewed exception: ${ALLOWED.advisory} in ${ALLOWED.package} (client-only; not imported).`,
  );
} else {
  console.log(
    `Production dependency audit passed. The ${ALLOWED.advisory} exception is no longer needed and can be removed.`,
  );
}
