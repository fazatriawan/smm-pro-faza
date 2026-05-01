import React from 'react';
import { Badge } from './index';
import { CheckCircle2, XCircle, AlertTriangle, HelpCircle } from 'lucide-react';

const STATUS_MAP = {
  connected:    { variant: 'success',  label: 'Terhubung', icon: CheckCircle2 },
  disconnected: { variant: 'error',    label: 'Terputus',  icon: XCircle },
  expired:      { variant: 'warning',  label: 'Expired',   icon: AlertTriangle },
  unknown:      { variant: 'default',  label: 'Belum dicek', icon: HelpCircle },
};

export default function AccountStatusBadge({ status }) {
  const cfg = STATUS_MAP[status] || STATUS_MAP.unknown;
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.variant} size="sm">
      <Icon size={10} />
      {cfg.label}
    </Badge>
  );
}
