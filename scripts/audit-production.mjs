import { spawnSync } from 'node:child_process';

// Fail on every production advisory, audit error, or unreadable report.

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

const blocking = [];
for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
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

console.log('Production dependency audit passed with no exceptions.');
