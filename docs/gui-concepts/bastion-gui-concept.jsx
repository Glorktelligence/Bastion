import { useEffect, useRef, useState } from 'react';

const COLORS = {
  bg: '#0a0a0f',
  bgCard: '#12121a',
  bgElevated: '#1a1a25',
  bgHover: '#22222f',
  border: '#2a2a3a',
  borderActive: '#3a3a4f',
  text: '#e8e8f0',
  textMuted: '#8888a0',
  textDim: '#55556a',
  accent: '#e94560',
  accentDim: '#e9456040',
  green: '#2dd4a0',
  greenDim: '#2dd4a020',
  greenMid: '#2dd4a060',
  amber: '#f0a030',
  amberDim: '#f0a03020',
  amberMid: '#f0a03060',
  red: '#ef4444',
  redDim: '#ef444420',
  blue: '#6099f0',
  blueDim: '#6099f020',
};

// Icon components
const Shield = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const Send = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const FileIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const Lock = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const AlertTriangle = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const Clock = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const Check = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const X = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const Activity = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const Search = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const _ChevronRight = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

// Status indicator
const StatusDot = ({ status }) => {
  const color = status === 'connected' ? COLORS.green : status === 'warning' ? COLORS.amber : COLORS.red;
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: color,
        boxShadow: `0 0 6px ${color}60`,
      }}
    />
  );
};

// Badge component
const Badge = ({ children, variant = 'default' }) => {
  const styles = {
    default: { bg: COLORS.bgElevated, color: COLORS.textMuted, border: COLORS.border },
    green: { bg: COLORS.greenDim, color: COLORS.green, border: COLORS.greenMid },
    amber: { bg: COLORS.amberDim, color: COLORS.amber, border: COLORS.amberMid },
    red: { bg: COLORS.redDim, color: COLORS.red, border: `${COLORS.red}60` },
    blue: { bg: COLORS.blueDim, color: COLORS.blue, border: `${COLORS.blue}60` },
  };
  const s = styles[variant];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.03em',
        backgroundColor: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {children}
    </span>
  );
};

// Sample messages for the demo
const DEMO_MESSAGES = [
  {
    id: 1,
    type: 'conversation',
    sender: 'human',
    timestamp: '14:23:08',
    content: 'Hey, can you check the nginx config on naval-app-01 and make sure the SSL certs are still valid?',
  },
  {
    id: 2,
    type: 'status',
    sender: 'ai',
    timestamp: '14:23:09',
    content: 'Received. Initiating SSL certificate validation on naval-app-01...',
    metadata: { task: 'SSL Cert Check', confidence: 'high', tools: ['ssh', 'openssl'] },
  },
  {
    id: 3,
    type: 'conversation',
    sender: 'ai',
    timestamp: '14:23:14',
    content:
      "SSL certificates on naval-app-01 are valid. The wildcard cert for *.glorktelligence.co.uk expires on 2026-09-14 — that's 190 days from now. The nginx configuration is clean, all redirects are working, and the security headers are intact. Grade A confirmed.",
    metadata: { task: 'SSL Cert Check', confidence: 'high', status: 'complete' },
  },
  {
    id: 4,
    type: 'conversation',
    sender: 'human',
    timestamp: '14:25:31',
    content: 'Nice. Now delete the old backup snapshots from naval-backup-01, anything older than 30 days.',
  },
  {
    id: 5,
    type: 'challenge',
    sender: 'ai',
    timestamp: '14:25:32',
    challenge: {
      reason: 'Irreversible bulk deletion detected',
      risk: 'high',
      layer: 2,
      factors: ['Irreversible operation', 'Bulk scope (47 snapshots matched)', 'No explicit confirmation of scope'],
      suggestion:
        'I can list the 47 snapshots that match first so you can review before deletion. Alternatively, I can delete in batches of 10 with confirmation between each batch.',
      original_task: 'Delete backup snapshots older than 30 days on naval-backup-01',
    },
  },
  {
    id: 6,
    type: 'confirmation',
    sender: 'human',
    timestamp: '14:26:15',
    content: "Good catch. Yeah, list them first and I'll confirm.",
    confirmation: { decision: 'modify', original_challenge: 5 },
  },
  {
    id: 7,
    type: 'conversation',
    sender: 'ai',
    timestamp: '14:26:18',
    content:
      'Here are the 47 snapshots on naval-backup-01 older than 30 days. Oldest is from 2025-11-03, newest qualifying is 2026-02-06. Total size: 234GB. Ready to proceed with deletion when you confirm, or I can exclude specific snapshots.',
    metadata: { task: 'Snapshot Review', confidence: 'high', status: 'awaiting_input' },
  },
];

const DEMO_FILES = [
  {
    id: 1,
    name: 'bastion-spec-v0.1.0.docx',
    size: '847 KB',
    direction: 'outbound',
    status: 'delivered',
    hash: 'a7f3c9...e2b1',
    timestamp: '14:20:03',
    project: 'Bastion',
  },
  {
    id: 2,
    name: 'fleet-status-2026-03.json',
    size: '12 KB',
    direction: 'inbound',
    status: 'accepted',
    hash: 'b2e4d1...f8a3',
    timestamp: '14:18:41',
    project: 'Naval Fleet',
  },
  {
    id: 3,
    name: 'nginx-audit-report.md',
    size: '3.2 KB',
    direction: 'outbound',
    status: 'pending',
    hash: 'c9a1f2...d4e7',
    timestamp: '14:23:16',
    project: 'Naval Fleet',
  },
];

const DEMO_AUDIT = [
  { id: 1, timestamp: '14:23:08', event: 'MESSAGE_DELIVERED', detail: 'Task → AI Client', level: 'info' },
  { id: 2, timestamp: '14:23:09', event: 'STATUS_UPDATE', detail: 'AI began SSL cert check', level: 'info' },
  { id: 3, timestamp: '14:23:14', event: 'TASK_COMPLETE', detail: 'SSL validation passed', level: 'success' },
  { id: 4, timestamp: '14:25:31', event: 'MESSAGE_DELIVERED', detail: 'Task → AI Client', level: 'info' },
  {
    id: 5,
    timestamp: '14:25:32',
    event: 'CHALLENGE_ISSUED',
    detail: 'Layer 2: Irreversible bulk deletion',
    level: 'warning',
  },
  { id: 6, timestamp: '14:25:32', event: 'EXECUTION_BLOCKED', detail: 'Awaiting human confirmation', level: 'warning' },
  { id: 7, timestamp: '14:26:15', event: 'CHALLENGE_MODIFIED', detail: 'Human chose: list first', level: 'info' },
  { id: 8, timestamp: '14:26:18', event: 'TASK_PIVOTED', detail: 'Listing snapshots for review', level: 'info' },
  {
    id: 9,
    timestamp: '14:26:18',
    event: 'FILE_QUARANTINED',
    detail: 'nginx-audit-report.md → outbound quarantine',
    level: 'info',
  },
];

// Message bubble component
const MessageBubble = ({ message }) => {
  const isHuman = message.sender === 'human';
  const isChallenge = message.type === 'challenge';
  const isConfirmation = message.type === 'confirmation';

  if (isChallenge) {
    return (
      <div
        style={{
          margin: '12px 0',
          padding: 0,
          maxWidth: '85%',
          borderRadius: 12,
          overflow: 'hidden',
          border: `1px solid ${COLORS.amberMid}`,
          backgroundColor: COLORS.amberDim,
        }}
      >
        <div
          style={{
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            backgroundColor: `${COLORS.amber}15`,
            borderBottom: `1px solid ${COLORS.amberMid}`,
          }}
        >
          <AlertTriangle />
          <span
            style={{ color: COLORS.amber, fontWeight: 700, fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}
          >
            CHALLENGE — LAYER {message.challenge.layer}
          </span>
          <Badge variant="amber">{message.challenge.risk} risk</Badge>
          <span
            style={{
              marginLeft: 'auto',
              color: COLORS.textDim,
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {message.timestamp}
          </span>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ color: COLORS.amber, fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
            {message.challenge.reason}
          </div>
          <div style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 12 }}>
            Task: "{message.challenge.original_task}"
          </div>
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                color: COLORS.textMuted,
                fontSize: 11,
                fontWeight: 600,
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Triggered Factors
            </div>
            {message.challenge.factors.map((f, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: COLORS.text,
                  fontSize: 12,
                  padding: '3px 0',
                }}
              >
                <span style={{ color: COLORS.amber }}>▸</span> {f}
              </div>
            ))}
          </div>
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              backgroundColor: `${COLORS.green}08`,
              border: `1px solid ${COLORS.greenDim}`,
            }}
          >
            <div
              style={{
                color: COLORS.green,
                fontSize: 11,
                fontWeight: 600,
                marginBottom: 4,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Suggested Alternative
            </div>
            <div style={{ color: COLORS.text, fontSize: 12, lineHeight: 1.5 }}>{message.challenge.suggestion}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 6,
                border: `1px solid ${COLORS.green}`,
                backgroundColor: COLORS.greenDim,
                color: COLORS.green,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              <Check /> Accept Suggestion
            </button>
            <button
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 6,
                border: `1px solid ${COLORS.amber}`,
                backgroundColor: COLORS.amberDim,
                color: COLORS.amber,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              Proceed Anyway
            </button>
            <button
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 6,
                border: `1px solid ${COLORS.red}60`,
                backgroundColor: COLORS.redDim,
                color: COLORS.red,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              <X /> Cancel Task
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isHuman ? 'flex-end' : 'flex-start',
        margin: '8px 0',
      }}
    >
      <div
        style={{
          maxWidth: '75%',
          padding: '10px 14px',
          borderRadius: 12,
          backgroundColor: isHuman ? COLORS.bgElevated : COLORS.bgCard,
          border: `1px solid ${isHuman ? COLORS.borderActive : COLORS.border}`,
          ...(isConfirmation ? { borderLeft: `3px solid ${COLORS.green}` } : {}),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: isHuman ? COLORS.accent : COLORS.blue,
              fontFamily: "'JetBrains Mono', monospace",
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {isHuman ? 'You' : 'AI Collaborator'}
          </span>
          {message.type !== 'conversation' && (
            <Badge variant={message.type === 'status' ? 'blue' : message.type === 'confirmation' ? 'green' : 'default'}>
              {message.type}
            </Badge>
          )}
          <span style={{ color: COLORS.textDim, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
            {message.timestamp}
          </span>
        </div>
        <div style={{ color: COLORS.text, fontSize: 13, lineHeight: 1.6 }}>{message.content}</div>
        {message.metadata && (
          <div
            style={{
              marginTop: 8,
              padding: '6px 10px',
              borderRadius: 6,
              backgroundColor: COLORS.bg,
              border: `1px solid ${COLORS.border}`,
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            {message.metadata.task && (
              <span style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
                <span style={{ color: COLORS.textDim }}>task:</span> {message.metadata.task}
              </span>
            )}
            {message.metadata.confidence && (
              <span style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
                <span style={{ color: COLORS.textDim }}>conf:</span>{' '}
                <span style={{ color: message.metadata.confidence === 'high' ? COLORS.green : COLORS.amber }}>
                  {message.metadata.confidence}
                </span>
              </span>
            )}
            {message.metadata.tools && (
              <span style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
                <span style={{ color: COLORS.textDim }}>tools:</span> {message.metadata.tools.join(', ')}
              </span>
            )}
            {message.metadata.status && (
              <span style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
                <span style={{ color: COLORS.textDim }}>status:</span>{' '}
                <span style={{ color: message.metadata.status === 'complete' ? COLORS.green : COLORS.amber }}>
                  {message.metadata.status}
                </span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Sidebar nav item
const NavItem = ({ icon, label, active, count, onClick }) => (
  <button
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      width: '100%',
      padding: '10px 14px',
      border: 'none',
      borderRadius: 8,
      cursor: 'pointer',
      transition: 'all 0.15s',
      backgroundColor: active ? COLORS.bgElevated : 'transparent',
      color: active ? COLORS.text : COLORS.textMuted,
      borderLeft: active ? `2px solid ${COLORS.accent}` : '2px solid transparent',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', monospace",
      textAlign: 'left',
    }}
  >
    {icon}
    <span style={{ flex: 1 }}>{label}</span>
    {count > 0 && <Badge variant="amber">{count}</Badge>}
  </button>
);

// File transfer row
const FileRow = ({ file }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 14px',
      borderBottom: `1px solid ${COLORS.border}`,
      fontSize: 12,
    }}
  >
    <div style={{ color: file.direction === 'inbound' ? COLORS.green : COLORS.blue }}>
      <FileIcon />
    </div>
    <div style={{ flex: 1 }}>
      <div style={{ color: COLORS.text, fontWeight: 500, fontFamily: "'JetBrains Mono', monospace" }}>{file.name}</div>
      <div style={{ color: COLORS.textDim, fontSize: 11, marginTop: 2 }}>
        {file.project} · {file.size} · {file.timestamp}
      </div>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Badge variant={file.direction === 'inbound' ? 'green' : 'blue'}>
        {file.direction === 'inbound' ? '↓ IN' : '↑ OUT'}
      </Badge>
      <Badge variant={file.status === 'delivered' || file.status === 'accepted' ? 'green' : 'amber'}>
        {file.status}
      </Badge>
    </div>
    <div style={{ color: COLORS.textDim, fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
      <Lock /> {file.hash}
    </div>
  </div>
);

// Audit log row
const AuditRow = ({ entry }) => {
  const levelColor =
    entry.level === 'success' ? COLORS.green : entry.level === 'warning' ? COLORS.amber : COLORS.textMuted;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '7px 14px',
        borderBottom: `1px solid ${COLORS.border}08`,
        fontSize: 12,
        borderLeft: `2px solid ${levelColor}40`,
      }}
    >
      <span style={{ color: COLORS.textDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, minWidth: 60 }}>
        {entry.timestamp}
      </span>
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          fontWeight: 600,
          color: levelColor,
          minWidth: 160,
        }}
      >
        {entry.event}
      </span>
      <span style={{ color: COLORS.text, fontSize: 12, flex: 1 }}>{entry.detail}</span>
    </div>
  );
};

// Main App
export default function BastionClient() {
  const [activeView, setActiveView] = useState('messages');
  const [inputValue, setInputValue] = useState('');
  const [inputMode, setInputMode] = useState('conversation');
  const messagesEndRef = useRef(null);
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const timeStr = time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const isHighRisk = time.getHours() >= 0 && time.getHours() < 6;

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        backgroundColor: COLORS.bg,
        color: COLORS.text,
        fontFamily: "'Segoe UI', -apple-system, sans-serif",
        overflow: 'hidden',
      }}
    >
      {/* Load fonts */}
      <link
        href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />

      {/* Sidebar */}
      <div
        style={{
          width: 240,
          backgroundColor: COLORS.bgCard,
          borderRight: `1px solid ${COLORS.border}`,
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        {/* Logo */}
        <div style={{ padding: '20px 16px 16px', borderBottom: `1px solid ${COLORS.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accent}90)`,
                boxShadow: `0 0 20px ${COLORS.accentDim}`,
              }}
            >
              <Shield />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>BASTION</div>
              <div
                style={{
                  fontSize: 10,
                  color: COLORS.textDim,
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: '0.05em',
                }}
              >
                GLORKTELLIGENCE
              </div>
            </div>
          </div>
          {/* Connection status */}
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              backgroundColor: COLORS.bg,
              border: `1px solid ${COLORS.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <StatusDot status="connected" />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: COLORS.green,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                CONNECTED
              </div>
              <div style={{ fontSize: 10, color: COLORS.textDim, fontFamily: "'JetBrains Mono', monospace" }}>
                Claude Opus · E2E Active
              </div>
            </div>
            <Lock />
          </div>
        </div>

        {/* Nav */}
        <div style={{ padding: '12px 8px', flex: 1 }}>
          <div
            style={{
              fontSize: 10,
              color: COLORS.textDim,
              padding: '4px 14px 8px',
              fontWeight: 600,
              letterSpacing: '0.1em',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            COMMUNICATION
          </div>
          <NavItem
            icon={<span>💬</span>}
            label="Messages"
            active={activeView === 'messages'}
            onClick={() => setActiveView('messages')}
            count={0}
          />
          <NavItem
            icon={<span>📋</span>}
            label="Tasks"
            active={activeView === 'tasks'}
            onClick={() => setActiveView('tasks')}
            count={1}
          />

          <div
            style={{
              fontSize: 10,
              color: COLORS.textDim,
              padding: '16px 14px 8px',
              fontWeight: 600,
              letterSpacing: '0.1em',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            SECURITY
          </div>
          <NavItem
            icon={<span>⚠️</span>}
            label="Challenges"
            active={activeView === 'challenges'}
            onClick={() => setActiveView('challenges')}
            count={1}
          />
          <NavItem
            icon={<span>📁</span>}
            label="File Airlock"
            active={activeView === 'files'}
            onClick={() => setActiveView('files')}
            count={1}
          />
          <NavItem
            icon={<span>📊</span>}
            label="Audit Log"
            active={activeView === 'audit'}
            onClick={() => setActiveView('audit')}
            count={0}
          />

          <div
            style={{
              fontSize: 10,
              color: COLORS.textDim,
              padding: '16px 14px 8px',
              fontWeight: 600,
              letterSpacing: '0.1em',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            SYSTEM
          </div>
          <NavItem
            icon={<span>⚙️</span>}
            label="Settings"
            active={activeView === 'settings'}
            onClick={() => setActiveView('settings')}
            count={0}
          />
        </div>

        {/* Footer status */}
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${COLORS.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Clock />
            <span
              style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: COLORS.text, fontWeight: 600 }}
            >
              {timeStr}
            </span>
          </div>
          {isHighRisk && (
            <div
              style={{
                padding: '6px 8px',
                borderRadius: 4,
                backgroundColor: COLORS.amberDim,
                border: `1px solid ${COLORS.amberMid}`,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <AlertTriangle />
              <span
                style={{
                  fontSize: 10,
                  color: COLORS.amber,
                  fontWeight: 600,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                HIGH-RISK HOURS ACTIVE
              </span>
            </div>
          )}
          <div
            style={{
              marginTop: 6,
              padding: '6px 8px',
              borderRadius: 4,
              backgroundColor: COLORS.bg,
              fontSize: 10,
              color: COLORS.textDim,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Relay: naval-bastion-01 · Latency: 2ms
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top bar */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: `1px solid ${COLORS.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            backgroundColor: COLORS.bgCard,
          }}
        >
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              {activeView === 'messages' && 'Secure Channel'}
              {activeView === 'tasks' && 'Active Tasks'}
              {activeView === 'challenges' && 'Challenge History'}
              {activeView === 'files' && 'File Airlock'}
              {activeView === 'audit' && 'Audit Log'}
              {activeView === 'settings' && 'Configuration'}
            </span>
            <span
              style={{ color: COLORS.textDim, fontSize: 12, marginLeft: 10, fontFamily: "'JetBrains Mono', monospace" }}
            >
              {activeView === 'messages' && 'End-to-end encrypted · All messages logged'}
              {activeView === 'files' && 'Quarantine → Manifest → Approve → Deliver'}
              {activeView === 'audit' && 'Authoritative relay log · Append-only · Tamper-evident'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Badge variant="green">
              <Lock /> E2E
            </Badge>
            <Badge variant="green">
              <Activity /> Healthy
            </Badge>
          </div>
        </div>

        {/* Content Area */}
        {activeView === 'messages' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {DEMO_MESSAGES.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div
              style={{
                padding: '12px 20px 16px',
                borderTop: `1px solid ${COLORS.border}`,
                backgroundColor: COLORS.bgCard,
              }}
            >
              {/* Mode selector */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {['conversation', 'task'].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setInputMode(mode)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: 4,
                      border: `1px solid ${inputMode === mode ? COLORS.accent : COLORS.border}`,
                      backgroundColor: inputMode === mode ? COLORS.accentDim : 'transparent',
                      color: inputMode === mode ? COLORS.accent : COLORS.textMuted,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: "'JetBrains Mono', monospace",
                      textTransform: 'uppercase',
                    }}
                  >
                    {mode}
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                <span
                  style={{
                    fontSize: 10,
                    color: COLORS.textDim,
                    fontFamily: "'JetBrains Mono', monospace",
                    alignSelf: 'center',
                  }}
                >
                  {inputMode === 'task'
                    ? '⚡ Tasks are evaluated by the safety engine before execution'
                    : '💬 Freeform — no automatic execution'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    backgroundColor: COLORS.bg,
                    borderRadius: 8,
                    padding: '4px 12px',
                    border: `1px solid ${COLORS.border}`,
                  }}
                >
                  <input
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder={inputMode === 'task' ? 'Describe the task...' : 'Type a message...'}
                    style={{
                      flex: 1,
                      border: 'none',
                      outline: 'none',
                      backgroundColor: 'transparent',
                      color: COLORS.text,
                      fontSize: 13,
                      padding: '8px 0',
                      fontFamily: "'Segoe UI', -apple-system, sans-serif",
                    }}
                  />
                  <button
                    style={{
                      padding: '6px',
                      border: 'none',
                      backgroundColor: 'transparent',
                      color: COLORS.textMuted,
                      cursor: 'pointer',
                      borderRadius: 4,
                    }}
                  >
                    <FileIcon />
                  </button>
                </div>
                <button
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: 'none',
                    backgroundColor: COLORS.accent,
                    color: 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  <Send /> Send
                </button>
              </div>
            </div>
          </div>
        )}

        {activeView === 'files' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* File airlock header */}
            <div
              style={{
                padding: '16px 20px',
                backgroundColor: COLORS.bgCard,
                borderBottom: `1px solid ${COLORS.border}`,
                display: 'flex',
                gap: 20,
              }}
            >
              {[
                { label: 'Quarantined', value: '1', color: COLORS.amber },
                { label: 'Pending Review', value: '1', color: COLORS.blue },
                { label: 'Transferred Today', value: '2', color: COLORS.green },
                { label: 'Rejected', value: '0', color: COLORS.textDim },
              ].map((stat, i) => (
                <div
                  key={i}
                  style={{
                    padding: '12px 16px',
                    borderRadius: 8,
                    backgroundColor: COLORS.bg,
                    border: `1px solid ${COLORS.border}`,
                    flex: 1,
                    textAlign: 'center',
                  }}
                >
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      color: stat.color,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {stat.value}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: COLORS.textMuted,
                      marginTop: 2,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
            {/* Pending file */}
            <div style={{ padding: '16px 20px' }}>
              <div
                style={{
                  borderRadius: 8,
                  border: `1px solid ${COLORS.amberMid}`,
                  backgroundColor: COLORS.amberDim,
                  overflow: 'hidden',
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    borderBottom: `1px solid ${COLORS.amberMid}`,
                    backgroundColor: `${COLORS.amber}10`,
                  }}
                >
                  <AlertTriangle />
                  <span
                    style={{
                      color: COLORS.amber,
                      fontWeight: 700,
                      fontSize: 12,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    FILE OFFER — AWAITING YOUR APPROVAL
                  </span>
                </div>
                <div style={{ padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <FileIcon />
                    <span
                      style={{
                        color: COLORS.text,
                        fontWeight: 600,
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 13,
                      }}
                    >
                      nginx-audit-report.md
                    </span>
                    <Badge variant="blue">↑ OUTBOUND</Badge>
                    <Badge>3.2 KB</Badge>
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8 }}>
                    AI generated this file during the SSL certificate validation task. Contains a summary of nginx
                    configuration findings on naval-app-01.
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 12,
                      fontSize: 11,
                      color: COLORS.textDim,
                      fontFamily: "'JetBrains Mono', monospace",
                      marginBottom: 12,
                    }}
                  >
                    <span>hash: c9a1f2...d4e7</span>
                    <span>project: Naval Fleet</span>
                    <span>encrypted: yes</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      style={{
                        padding: '8px 16px',
                        borderRadius: 6,
                        border: `1px solid ${COLORS.green}`,
                        backgroundColor: COLORS.greenDim,
                        color: COLORS.green,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: "'JetBrains Mono', monospace",
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Check /> Accept & Download
                    </button>
                    <button
                      style={{
                        padding: '8px 16px',
                        borderRadius: 6,
                        border: `1px solid ${COLORS.red}60`,
                        backgroundColor: COLORS.redDim,
                        color: COLORS.red,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: "'JetBrains Mono', monospace",
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <X /> Reject
                    </button>
                  </div>
                </div>
              </div>

              <div
                style={{
                  fontSize: 11,
                  color: COLORS.textDim,
                  fontWeight: 600,
                  marginBottom: 8,
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: '0.05em',
                }}
              >
                TRANSFER HISTORY
              </div>
              <div style={{ borderRadius: 8, border: `1px solid ${COLORS.border}`, overflow: 'hidden' }}>
                {DEMO_FILES.filter((f) => f.status !== 'pending').map((f) => (
                  <FileRow key={f.id} file={f} />
                ))}
              </div>
            </div>
          </div>
        )}

        {activeView === 'audit' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* Search bar */}
            <div
              style={{
                padding: '12px 20px',
                borderBottom: `1px solid ${COLORS.border}`,
                backgroundColor: COLORS.bgCard,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  backgroundColor: COLORS.bg,
                  borderRadius: 6,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <Search />
                <input
                  placeholder="Filter by event, detail, or time range..."
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    backgroundColor: 'transparent',
                    color: COLORS.text,
                    fontSize: 12,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                />
                <div style={{ display: 'flex', gap: 4 }}>
                  {['all', 'info', 'success', 'warning'].map((lvl) => (
                    <button
                      key={lvl}
                      style={{
                        padding: '2px 8px',
                        borderRadius: 3,
                        border: `1px solid ${COLORS.border}`,
                        backgroundColor: lvl === 'all' ? COLORS.bgElevated : 'transparent',
                        color: lvl === 'all' ? COLORS.text : COLORS.textDim,
                        fontSize: 10,
                        cursor: 'pointer',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {/* Audit entries */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {DEMO_AUDIT.map((entry) => (
                <AuditRow key={entry.id} entry={entry} />
              ))}
            </div>
            {/* Audit footer */}
            <div
              style={{
                padding: '8px 20px',
                borderTop: `1px solid ${COLORS.border}`,
                backgroundColor: COLORS.bgCard,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <span style={{ fontSize: 10, color: COLORS.textDim, fontFamily: "'JetBrains Mono', monospace" }}>
                9 events · Source: naval-bastion-01 relay · Append-only · Tamper-evident
              </span>
              <div style={{ flex: 1 }} />
              <Badge variant="green">Integrity verified</Badge>
            </div>
          </div>
        )}

        {activeView === 'challenges' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
            <div
              style={{
                display: 'flex',
                gap: 16,
                marginBottom: 20,
              }}
            >
              {[
                { label: 'Total Challenges', value: '12', sub: 'Last 30 days' },
                { label: 'Accepted Suggestions', value: '8', sub: '66.7%' },
                { label: 'Proceeded Anyway', value: '3', sub: '25.0%' },
                { label: 'Cancelled', value: '1', sub: '8.3%' },
              ].map((s, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    padding: '14px 16px',
                    borderRadius: 8,
                    backgroundColor: COLORS.bgCard,
                    border: `1px solid ${COLORS.border}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: COLORS.text,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {s.value}
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>{s.label}</div>
                  <div style={{ fontSize: 10, color: COLORS.textDim, fontFamily: "'JetBrains Mono', monospace" }}>
                    {s.sub}
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                fontSize: 11,
                color: COLORS.textDim,
                fontWeight: 600,
                marginBottom: 8,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.05em',
              }}
            >
              RECENT CHALLENGES
            </div>
            {/* Show the challenge from messages */}
            {DEMO_MESSAGES.filter((m) => m.type === 'challenge').map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>
        )}

        {activeView === 'tasks' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
            <div
              style={{
                fontSize: 11,
                color: COLORS.textDim,
                fontWeight: 600,
                marginBottom: 12,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.05em',
              }}
            >
              ACTIVE TASKS
            </div>
            <div
              style={{
                padding: 16,
                borderRadius: 8,
                backgroundColor: COLORS.bgCard,
                border: `1px solid ${COLORS.amberMid}`,
                marginBottom: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Badge variant="amber">awaiting input</Badge>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Delete old backup snapshots</span>
              </div>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8 }}>
                Originally requested bulk deletion of snapshots older than 30 days on naval-backup-01. Challenge issued
                — modified to list-first approach. 47 snapshots listed, awaiting final confirmation.
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  fontSize: 11,
                  color: COLORS.textDim,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                <span>target: naval-backup-01</span>
                <span>scope: 47 snapshots · 234GB</span>
                <span>safety: Layer 2 challenge resolved</span>
              </div>
            </div>

            <div
              style={{
                fontSize: 11,
                color: COLORS.textDim,
                fontWeight: 600,
                marginBottom: 12,
                marginTop: 24,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.05em',
              }}
            >
              COMPLETED TODAY
            </div>
            <div
              style={{
                padding: 16,
                borderRadius: 8,
                backgroundColor: COLORS.bgCard,
                border: `1px solid ${COLORS.border}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Badge variant="green">complete</Badge>
                <span style={{ fontWeight: 600, fontSize: 14 }}>SSL certificate validation</span>
              </div>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8 }}>
                Validated SSL certificates on naval-app-01. Wildcard cert for *.glorktelligence.co.uk valid until
                2026-09-14. Grade A confirmed. Nginx configuration clean.
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  fontSize: 11,
                  color: COLORS.textDim,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                <span>target: naval-app-01</span>
                <span>duration: 5.2s</span>
                <span>safety: no flags</span>
              </div>
            </div>
          </div>
        )}

        {activeView === 'settings' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
            <div
              style={{
                fontSize: 11,
                color: COLORS.textDim,
                fontWeight: 600,
                marginBottom: 12,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.05em',
              }}
            >
              SAFETY EVALUATION ENGINE
            </div>
            {[
              { label: 'High-risk hours', value: '00:00–06:00', floor: 'Cannot be disabled', adjustable: true },
              { label: 'Time-of-day scrutiny weight', value: '1.5×', floor: '1.2× minimum', adjustable: true },
              { label: 'Irreversible action behaviour', value: 'Always challenge', floor: 'Locked', adjustable: false },
              { label: 'Pattern deviation sensitivity', value: 'Medium', floor: 'Low minimum', adjustable: true },
              { label: 'File transfer quarantine', value: 'Enabled', floor: 'Locked', adjustable: false },
            ].map((setting, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px 14px',
                  backgroundColor: COLORS.bgCard,
                  borderRadius: 8,
                  marginBottom: 6,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.text }}>{setting.label}</div>
                  <div
                    style={{
                      fontSize: 11,
                      color: COLORS.textDim,
                      fontFamily: "'JetBrains Mono', monospace",
                      marginTop: 2,
                    }}
                  >
                    Floor: {setting.floor}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: COLORS.text,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {setting.value}
                  </span>
                  {setting.adjustable ? (
                    <button
                      style={{
                        padding: '4px 10px',
                        borderRadius: 4,
                        border: `1px solid ${COLORS.border}`,
                        backgroundColor: COLORS.bgElevated,
                        color: COLORS.textMuted,
                        fontSize: 11,
                        cursor: 'pointer',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      Tighten ↑
                    </button>
                  ) : (
                    <Badge variant="red">🔒 LOCKED</Badge>
                  )}
                </div>
              </div>
            ))}

            <div
              style={{
                fontSize: 11,
                color: COLORS.textDim,
                fontWeight: 600,
                marginBottom: 12,
                marginTop: 24,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.05em',
              }}
            >
              CONNECTION
            </div>
            {[
              { label: 'Relay address', value: 'wss://bastion.glorktelligence.co.uk' },
              { label: 'AI Provider', value: 'Anthropic (Claude Opus)' },
              { label: 'Encryption', value: 'E2E · Client-side keys · Zero-knowledge relay' },
              { label: 'Session token expiry', value: '15 minutes (auto-refresh)' },
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 14px',
                  backgroundColor: COLORS.bgCard,
                  borderRadius: 8,
                  marginBottom: 6,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <span style={{ fontSize: 13, color: COLORS.textMuted, flex: 1 }}>{item.label}</span>
                <span style={{ fontSize: 12, color: COLORS.text, fontFamily: "'JetBrains Mono', monospace" }}>
                  {item.value}
                </span>
              </div>
            ))}

            <div
              style={{
                fontSize: 11,
                color: COLORS.textDim,
                fontWeight: 600,
                marginBottom: 12,
                marginTop: 24,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.05em',
              }}
            >
              THE MALICLAW CLAUSE
            </div>
            <div
              style={{
                padding: 16,
                borderRadius: 8,
                backgroundColor: COLORS.redDim,
                border: `1px solid ${COLORS.red}40`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Badge variant="red">🔒 NON-NEGOTIABLE</Badge>
                <span style={{ fontWeight: 600, fontSize: 13, color: COLORS.red }}>Active & Non-Bypassable</span>
              </div>
              <div style={{ fontSize: 12, color: COLORS.text, lineHeight: 1.5 }}>
                Connections from OpenClaw, Clawdbot, Moltbot, and known derivatives are rejected unconditionally at the
                TLS handshake level. This check operates independently of the allowlist and cannot be disabled through
                configuration.
              </div>
              <div
                style={{ fontSize: 11, color: COLORS.textDim, fontFamily: "'JetBrains Mono', monospace", marginTop: 8 }}
              >
                Last rejected: 0 attempts · Blocklist version: 1.0.0
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
