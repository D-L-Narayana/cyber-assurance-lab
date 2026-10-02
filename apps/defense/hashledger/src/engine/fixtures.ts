import type { FileEntry } from './snapshot';
/* Synthetic fixture directory. Every value is invented; identifiers follow a shape only. */
export const SAMPLE_FILES: FileEntry[] = [
  { path: 'README.md', mode: '0644', owner: 'svc-docs', content: '# Fixture workspace\n\nPublic documentation for the synthetic demo. Nothing here is sensitive.' },
  { path: 'LICENSE', mode: '0644', owner: 'svc-docs', content: 'MIT License (fixture copy)' },
  { path: 'src/app.ts', mode: '0644', owner: 'svc-build', content: 'export function start() {\n  return "hello";\n}\n' },
  { path: 'src/config.ts', mode: '0644', owner: 'svc-build', content: 'export const config = { region: "eu-west-1", retries: 3 };\n' },
  { path: 'hr/payroll_q3.csv', mode: '0640', owner: 'svc-hr', content: 'name,id,pay\nAna Example,123-45-6789,5200\nBo Example,987-65-4321,4800\nCy Example,555-12-3456,6100' },
  { path: 'legal/memo_vendor_review.txt', mode: '0640', owner: 'svc-legal', content: 'CONFIDENTIAL\nVendor review memo for Partner Example Ltd. Draft for counsel.' },
  { path: 'finance/refunds_test_cards.csv', mode: '0640', owner: 'svc-fin', content: 'order,card\nA-1001,4111 1111 1111 1111\nA-1002,5500 0000 0000 0004' },
  { path: 'sales/orders_export.csv', mode: '0644', owner: 'svc-sales', content: 'order,ref\n1,4111111111111112\n2,5500000000000005\n3,1234567812345678' },
  { path: 'ops/deploy_key.pem', mode: '0600', owner: 'svc-ops', content: '-----BEGIN RSA PRIVATE KEY-----\nSYNTHETIC-FIXTURE-NOT-A-REAL-KEY\n-----END RSA PRIVATE KEY-----' },
  { path: 'ops/runbook.md', mode: '0644', owner: 'svc-ops', content: '# Runbook\n\n1. Rotate keys quarterly.\n2. Review payroll access list.' },
  { path: 'marketing/launch_plan.md', mode: '0644', owner: 'svc-mkt', content: 'Launch plan for the autumn campaign. Public once announced.' },
  { path: 'bin/backup.sh', mode: '0755', owner: 'svc-ops', content: '#!/bin/sh\necho "backup fixture"\n' },
];
