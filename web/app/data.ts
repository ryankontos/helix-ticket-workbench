export type HoldState = 'on_legal_hold' | 'not_on_legal_hold' | 'unknown';

export type LegalHoldItem = {
  device_name?: string;
  serial_number?: string;
  legal_hold?: string;
  classification?: HoldState;
  reason?: string;
  safe_to_proceed?: boolean;
  cmdb_record_exists?: boolean;
  sccm_record_exists?: boolean;
};

export type ToolkitAttempt = {
  attempt?: number;
  started_at?: string;
  finished_at?: string;
  http_status?: number | null;
  response_url?: string | null;
  data?: unknown;
  error?: string | null;
};

export type ToolkitResult = {
  serial: string;
  success: boolean;
  attempt_count: number;
  attempts: ToolkitAttempt[];
  legal_holds: LegalHoldItem[];
  overall_legal_hold: HoldState;
  screenshot?: string | null;
  screenshot_scope?: string | null;
  final_data?: unknown;
  error?: string | null;
};

export type HistoryRecord = {
  id: string;
  checked_at: string;
  serial: string;
  success: boolean;
  overall_legal_hold: HoldState;
  legal_hold?: string;
  device_name?: string;
  serial_number?: string;
  attempt_count: number;
  screenshot?: string | null;
  screenshot_scope?: string | null;
  screenshot_directory?: string;
  device_info_path?: string;
  error?: string | null;
};

export type DeviceInfoFile = {
  schema_version: number;
  check_id: string;
  checked_at: string;
  serial: string;
  result: ToolkitResult;
};

export type HistoryDetail = {
  record: HistoryRecord;
  device_info: DeviceInfoFile | null;
};

export function holdLabel(value: HoldState) {
  if (value === 'not_on_legal_hold') return 'Not flagged';
  if (value === 'on_legal_hold') return 'Legal hold';
  return 'Review';
}

export function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function firstDevice(result?: ToolkitResult | null) {
  const payload = objectValue(result?.final_data);
  const devices = payload?.devices;
  return Array.isArray(devices) && devices.length ? objectValue(devices[0]) : null;
}

export function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function prettyKey(value: string) {
  return value
    .replaceAll('_', ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, character => character.toUpperCase());
}
