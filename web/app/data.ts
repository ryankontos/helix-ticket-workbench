export type Workspace = 'queue' | 'toolkit' | 'templates' | 'activity' | 'settings';

export type Ticket = {
  id: string;
  serial: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  owner: string;
  assignee: string;
  customer: string;
  modified: string;
  age: string;
  category: string;
};

export type TemplateAction = {
  id: string;
  enabled: boolean;
  kind: 'field' | 'worklog' | 'attachment';
  field: string;
  value: string;
};

export type ModificationTemplate = {
  id: string;
  name: string;
  description: string;
  accent: string;
  guard: string;
  actions: TemplateAction[];
};

export type ToolkitResult = {
  serial: string;
  success: boolean;
  attempt_count: number;
  overall_legal_hold: 'on_legal_hold' | 'not_on_legal_hold' | 'unknown';
  legal_holds: Array<{
    device_name?: string;
    serial_number?: string;
    legal_hold?: string;
    classification?: string;
    reason?: string;
    safe_to_proceed?: boolean;
  }>;
  screenshot?: string | null;
  final_data?: unknown;
  attempts?: unknown[];
  error?: string | null;
};

export const tickets: Ticket[] = [
  { id: 'INC00178432', serial: 'C02ZK41', title: 'MacBook returned for rebuild', description: 'Returned device has been received and is ready for legal-hold verification before secure rebuild.', status: 'In Progress', priority: 'Low', owner: 'Workplace Technology', assignee: 'Jordan Lee', customer: 'Alex Morgan', modified: '8 minutes ago', age: '18m', category: 'Rebuild' },
  { id: 'INC00178391', serial: 'FVFG91K', title: 'Device ready for secure rebuild', description: 'Device collected from the Sydney office and queued for standard rebuild processing.', status: 'Assigned', priority: 'Medium', owner: 'Device Operations', assignee: 'Taylor Chen', customer: 'Sam Rivera', modified: '31 minutes ago', age: '43m', category: 'Rebuild' },
  { id: 'INC00178104', serial: 'DLXQ20M', title: 'Leaver equipment processing', description: 'Returned laptop requires ownership and legal-hold checks before disposition.', status: 'Pending', priority: 'Low', owner: 'Workplace Technology', assignee: 'Jordan Lee', customer: 'Morgan Bell', modified: '1 hour ago', age: '2h', category: 'Leaver' },
  { id: 'INC00177985', serial: 'C17XW8P', title: 'Reimage and return to stock', description: 'Prepare device for rebuild, validate restrictions and return to available inventory.', status: 'In Progress', priority: 'Low', owner: 'End User Compute', assignee: 'Avery Patel', customer: 'Jamie Ford', modified: '2 hours ago', age: '4h', category: 'Rebuild' },
  { id: 'INC00177844', serial: 'G8PL3Q2', title: 'Retired device disposal review', description: 'Confirm device status and evidence before disposal workflow can proceed.', status: 'Assigned', priority: 'Medium', owner: 'Asset Lifecycle', assignee: 'Casey Wong', customer: 'Drew Evans', modified: '4 hours ago', age: '6h', category: 'Disposal' },
];

export const defaultTemplates: ModificationTemplate[] = [
  {
    id: 'mark-rebuilt',
    name: 'Mark as rebuilt',
    description: 'Verify legal hold evidence, add a work note and resolve the rebuild ticket.',
    accent: '#087f75',
    guard: 'Require PC Toolkit result: NotFlagged',
    actions: [
      { id: 'a1', enabled: true, kind: 'worklog', field: 'Detailed Description', value: 'PC Toolkit legal hold check completed for {{serial}}. Result: {{legal_hold}}. Evidence attached.' },
      { id: 'a2', enabled: true, kind: 'attachment', field: 'Work Log Attachment', value: '{{legal_hold_screenshot}}' },
      { id: 'a3', enabled: true, kind: 'field', field: 'Resolution', value: 'Device {{serial}} was verified and marked for rebuild.' },
      { id: 'a4', enabled: true, kind: 'field', field: 'Status', value: 'Resolved' },
      { id: 'a5', enabled: true, kind: 'field', field: 'Status_Reason', value: 'No Further Action Required' },
      { id: 'a6', enabled: true, kind: 'field', field: 'Resolution Category', value: 'Rebuild completed' },
    ],
  },
  {
    id: 'add-evidence-note',
    name: 'Add evidence note',
    description: 'Add PC Toolkit evidence without changing the ticket status.',
    accent: '#3568a8',
    guard: 'Require one evidence file',
    actions: [
      { id: 'b1', enabled: true, kind: 'worklog', field: 'Detailed Description', value: 'Device information and legal hold status reviewed for {{serial}}.' },
      { id: 'b2', enabled: true, kind: 'attachment', field: 'Work Log Attachment', value: '{{legal_hold_screenshot}}' },
    ],
  },
  {
    id: 'return-to-queue',
    name: 'Return to rebuild queue',
    description: 'Reassign a validated device ticket to the rebuild queue.',
    accent: '#7b5cab',
    guard: 'Ticket must be Assigned or In Progress',
    actions: [
      { id: 'c1', enabled: true, kind: 'field', field: 'Assigned Group', value: 'Workplace Technology' },
      { id: 'c2', enabled: true, kind: 'field', field: 'Assignee', value: '' },
      { id: 'c3', enabled: true, kind: 'field', field: 'Status', value: 'Assigned' },
      { id: 'c4', enabled: true, kind: 'worklog', field: 'Detailed Description', value: 'Device {{serial}} returned to rebuild queue after review.' },
    ],
  },
];

export const fieldOptions = [
  'Status', 'Status_Reason', 'Resolution', 'Resolution Category', 'Assigned Group',
  'Assignee', 'Priority', 'Summary', 'Detailed Description', 'Work Log Type',
  'Work Log Attachment', 'Operational Category Tier 1', 'Product Category Tier 1',
];

export const variableTokens = ['{{ticket_id}}', '{{serial}}', '{{device_name}}', '{{owner_name}}', '{{legal_hold}}', '{{legal_hold_screenshot}}'];

export function resolveTemplate(value: string, ticket: Ticket, result?: ToolkitResult) {
  const hold = result?.legal_holds?.[0];
  const values: Record<string, string> = {
    '{{ticket_id}}': ticket.id,
    '{{serial}}': ticket.serial,
    '{{device_name}}': hold?.device_name || 'Unknown device',
    '{{owner_name}}': ticket.customer,
    '{{legal_hold}}': hold?.legal_hold || 'Unchecked',
    '{{legal_hold_screenshot}}': result?.screenshot || 'No screenshot selected',
  };
  return Object.entries(values).reduce((text, [token, replacement]) => text.replaceAll(token, replacement), value);
}

export const demoToolkitResults: ToolkitResult[] = [
  {
    serial: 'C02ZK41', success: true, attempt_count: 3, overall_legal_hold: 'not_on_legal_hold', screenshot: '/Users/example/Desktop/legal-hold/C02ZK41.png',
    legal_holds: [{ device_name: 'MAC-SYD-0142', serial_number: 'C02ZK41', legal_hold: 'NotFlagged', classification: 'not_on_legal_hold', reason: 'api_value_not_flagged', safe_to_proceed: true }],
    final_data: { searchTerm: 'C02ZK41', devicesFound: 1, devices: [{ name: 'MAC-SYD-0142', cmdb: { legalHold: 'NotFlagged', ciDetails: { serialNumber: 'C02ZK41', productName: 'MacBook Pro', status: 'Deployed', site: 'Sydney' }, people: [{ type: 'User', role: 'Owned by', loginID: 'example.user', fullName: 'Example User' }] }, sccm: null }] },
    attempts: [{ attempt: 1, data: { devicesFound: 0, devices: [] } }, { attempt: 2, data: { devicesFound: 0, devices: [] } }, { attempt: 3, data: { devicesFound: 1 } }],
  },
  {
    serial: 'FVFG91K', success: true, attempt_count: 1, overall_legal_hold: 'unknown', screenshot: null,
    legal_holds: [{ device_name: 'MAC-MEL-0088', serial_number: 'FVFG91K', legal_hold: 'NotFound', classification: 'unknown', reason: 'legal_hold_record_not_found', safe_to_proceed: false }],
    final_data: { searchTerm: 'FVFG91K', devicesFound: 1, devices: [{ name: 'MAC-MEL-0088', cmdb: { legalHold: 'NotFound', ciDetails: { serialNumber: 'FVFG91K', productName: 'MacBook Air', status: 'Deployed', site: 'Melbourne' } }, sccm: null }] },
  },
];
