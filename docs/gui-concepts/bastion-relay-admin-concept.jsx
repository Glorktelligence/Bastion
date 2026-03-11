import { useEffect, useState } from 'react';

// Relay admin uses a distinctly different palette — industrial, utilitarian
const C = {
  bg: '#0c0e11',
  bgPanel: '#13161b',
  bgCard: '#1a1d24',
  bgHover: '#21252e',
  bgInput: '#0f1115',
  border: '#2a2e38',
  borderHi: '#3a3f4d',
  text: '#d4d8e0',
  textMuted: '#7a8194',
  textDim: '#4a5068',
  // Intentionally different accent from human client
  primary: '#38bdf8', // Infrastructure blue
  primaryDim: '#38bdf815',
  primaryMid: '#38bdf840',
  green: '#34d399',
  greenDim: '#34d39915',
  greenMid: '#34d39940',
  amber: '#fbbf24',
  amberDim: '#fbbf2415',
  amberMid: '#fbbf2440',
  red: '#f87171',
  redDim: '#f8717115',
  redMid: '#f8717140',
  accent: '#e94560', // Glorktelligence red — shared brand element
};

// SVG Icons
const Server = () => (
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
    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
    <line x1="6" y1="6" x2="6.01" y2="6" />
    <line x1="6" y1="18" x2="6.01" y2="18" />
  </svg>
);
const Users = () => (
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
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const ShieldIcon = () => (
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
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
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
const Database = () => (
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
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
);
const Terminal = () => (
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
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);
const Ban = () => (
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
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
  </svg>
);
const CheckCircle = () => (
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
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);
const XCircle = () => (
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
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
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
const Lock = () => (
  <svg
    width="12"
    height="12"
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
const Zap = () => (
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
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

// Status indicator with pulse animation
const StatusPulse = ({ status }) => {
  const color = status === 'healthy' ? C.green : status === 'warning' ? C.amber : C.red;
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 10,
        height: 10,
      }}
    >
      <span
        style={{
          position: 'absolute',
          width: 10,
          height: 10,
          borderRadius: '50%',
          backgroundColor: color,
          opacity: 0.3,
          animation: status === 'healthy' ? 'pulse 2s infinite' : 'none',
        }}
      />
      <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color, position: 'relative' }} />
    </span>
  );
};

// Monospace badge
const Tag = ({ children, color = C.textMuted, bg = C.bgCard, border: borderColor = C.border }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 7px',
      borderRadius: 3,
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.04em',
      backgroundColor: bg,
      color,
      border: `1px solid ${borderColor}`,
      fontFamily: "'IBM Plex Mono', monospace",
    }}
  >
    {children}
  </span>
);

// Metric card
const Metric = ({ label, value, sub, color = C.text, icon }) => (
  <div
    style={{
      padding: '16px 18px',
      backgroundColor: C.bgCard,
      borderRadius: 6,
      border: `1px solid ${C.border}`,
      flex: 1,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
      <span style={{ color: C.textDim }}>{icon}</span>
      <span
        style={{
          fontSize: 11,
          color: C.textMuted,
          fontFamily: "'IBM Plex Mono', monospace",
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </span>
    </div>
    <div style={{ fontSize: 32, fontWeight: 700, color, fontFamily: "'IBM Plex Mono', monospace", lineHeight: 1 }}>
      {value}
    </div>
    {sub && (
      <div style={{ fontSize: 11, color: C.textDim, fontFamily: "'IBM Plex Mono', monospace", marginTop: 6 }}>
        {sub}
      </div>
    )}
  </div>
);

// Provider row
const ProviderRow = ({ provider, onRevoke }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: '1fr 120px 120px 100px 140px 80px',
      alignItems: 'center',
      padding: '12px 16px',
      borderBottom: `1px solid ${C.border}08`,
      fontSize: 12,
      transition: 'background 0.1s',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <StatusPulse status={provider.status} />
      <div>
        <div style={{ fontWeight: 600, color: C.text, fontFamily: "'IBM Plex Mono', monospace" }}>{provider.name}</div>
        <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>{provider.id}</div>
      </div>
    </div>
    <Tag
      color={provider.status === 'healthy' ? C.green : C.amber}
      bg={provider.status === 'healthy' ? C.greenDim : C.amberDim}
      border={provider.status === 'healthy' ? C.greenMid : C.amberMid}
    >
      {provider.status}
    </Tag>
    <span style={{ color: C.textMuted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>{provider.model}</span>
    <span style={{ color: C.textMuted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
      {provider.sessions}
    </span>
    <span style={{ color: C.textDim, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
      {provider.lastSeen}
    </span>
    <button
      onClick={onRevoke}
      style={{
        padding: '4px 10px',
        borderRadius: 3,
        border: `1px solid ${C.redMid}`,
        backgroundColor: C.redDim,
        color: C.red,
        fontSize: 10,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      REVOKE
    </button>
  </div>
);

// Blocklist entry
const BlockEntry = ({ entry }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 16px',
      borderBottom: `1px solid ${C.border}08`,
    }}
  >
    <Ban />
    <div style={{ flex: 1 }}>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600, color: C.red }}>
        {entry.pattern}
      </span>
      <span style={{ color: C.textDim, fontSize: 11, marginLeft: 12 }}>{entry.reason}</span>
    </div>
    <Tag color={C.textDim}>{entry.hits} rejected</Tag>
    {entry.locked && (
      <Tag color={C.red} bg={C.redDim} border={C.redMid}>
        <Lock /> LOCKED
      </Tag>
    )}
  </div>
);

// Connection log entry
const ConnectionEntry = ({ entry }) => {
  const statusColor = entry.result === 'accepted' ? C.green : entry.result === 'rejected' ? C.red : C.amber;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '70px 120px 1fr 100px 80px',
        alignItems: 'center',
        padding: '8px 16px',
        borderBottom: `1px solid ${C.border}08`,
        fontSize: 11,
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      <span style={{ color: C.textDim }}>{entry.time}</span>
      <span style={{ color: C.textMuted }}>{entry.source}</span>
      <span style={{ color: C.text }}>{entry.detail}</span>
      <Tag color={statusColor} bg={`${statusColor}15`} border={`${statusColor}40`}>
        {entry.result}
      </Tag>
      <span style={{ color: C.textDim }}>{entry.latency}</span>
    </div>
  );
};

// Demo data
const PROVIDERS = [
  {
    id: 'prov_anth_001',
    name: 'Anthropic Claude',
    model: 'claude-opus',
    status: 'healthy',
    sessions: '1 active',
    lastSeen: '2s ago',
  },
];

const BLOCKLIST = [
  { pattern: 'openclaw/*', reason: 'MaliClaw Clause — non-negotiable', hits: 0, locked: true },
  { pattern: 'clawdbot/*', reason: 'MaliClaw Clause — non-negotiable', hits: 0, locked: true },
  { pattern: 'moltbot/*', reason: 'MaliClaw Clause — non-negotiable', hits: 0, locked: true },
  { pattern: 'clawrouter/*', reason: 'MaliClaw Clause — derivative', hits: 0, locked: true },
];

const CONNECTIONS = [
  {
    time: '14:26:18',
    source: '10.0.50.10',
    detail: 'AI Client heartbeat — healthy',
    result: 'accepted',
    latency: '1ms',
  },
  {
    time: '14:26:03',
    source: '10.0.10.5',
    detail: 'Human Client message — task type',
    result: 'accepted',
    latency: '2ms',
  },
  {
    time: '14:25:32',
    source: '10.0.50.10',
    detail: 'AI Client challenge issued — Layer 2',
    result: 'accepted',
    latency: '1ms',
  },
  {
    time: '14:23:08',
    source: '10.0.10.5',
    detail: 'Human Client message — conversation type',
    result: 'accepted',
    latency: '2ms',
  },
  {
    time: '14:20:03',
    source: '10.0.50.10',
    detail: 'AI Client file-offer — nginx-audit-report.md',
    result: 'accepted',
    latency: '1ms',
  },
  {
    time: '14:15:00',
    source: '10.0.50.10',
    detail: 'AI Client session established — JWT valid',
    result: 'accepted',
    latency: '3ms',
  },
  {
    time: '14:14:58',
    source: '10.0.10.5',
    detail: 'Human Client session established — JWT valid',
    result: 'accepted',
    latency: '2ms',
  },
  {
    time: '14:10:22',
    source: '85.214.x.x',
    detail: 'Unknown client — no valid credentials',
    result: 'rejected',
    latency: '0ms',
  },
  { time: '13:45:01', source: '10.0.50.10', detail: 'AI Client token refresh', result: 'accepted', latency: '1ms' },
];

const QUARANTINE_STATS = {
  inbound: { current: 0, total: 14, avgSize: '28 KB' },
  outbound: { current: 1, total: 8, avgSize: '3.8 KB' },
  rejected: { current: 0, total: 0 },
  hashMismatches: 0,
};

export default function RelayAdmin() {
  const [activeSection, setActiveSection] = useState('overview');
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const uptime = '14d 7h 23m';
  const timeStr = time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const sections = [
    { id: 'overview', label: 'OVERVIEW', icon: <Activity /> },
    { id: 'providers', label: 'PROVIDERS', icon: <Users /> },
    { id: 'blocklist', label: 'BLOCKLIST', icon: <ShieldIcon /> },
    { id: 'quarantine', label: 'QUARANTINE', icon: <Database /> },
    { id: 'connections', label: 'CONNECTIONS', icon: <Terminal /> },
    { id: 'system', label: 'SYSTEM', icon: <Server /> },
  ];

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        backgroundColor: C.bg,
        color: C.text,
        fontFamily: "'Segoe UI', -apple-system, sans-serif",
        overflow: 'hidden',
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <style>{`
        @keyframes pulse { 0%, 100% { transform: scale(1); opacity: 0.3; } 50% { transform: scale(1.8); opacity: 0; } }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
      `}</style>

      {/* Sidebar — tighter, more utilitarian */}
      <div
        style={{
          width: 200,
          backgroundColor: C.bgPanel,
          borderRight: `1px solid ${C.border}`,
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 14px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: C.primaryDim,
                border: `1px solid ${C.primaryMid}`,
                color: C.primary,
              }}
            >
              <Server />
            </div>
            <div>
              <div
                style={{ fontWeight: 700, fontSize: 13, fontFamily: "'IBM Plex Mono', monospace", color: C.primary }}
              >
                RELAY ADMIN
              </div>
            </div>
          </div>
          <div
            style={{
              padding: '6px 8px',
              borderRadius: 3,
              backgroundColor: C.bgInput,
              border: `1px solid ${C.border}`,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
            }}
          >
            <div style={{ color: C.textDim }}>naval-bastion-01</div>
            <div style={{ color: C.green, fontWeight: 600, marginTop: 2 }}>● OPERATIONAL</div>
          </div>
        </div>

        {/* Nav */}
        <div style={{ padding: '8px 6px', flex: 1 }}>
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '9px 10px',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                marginBottom: 2,
                backgroundColor: activeSection === s.id ? C.bgCard : 'transparent',
                color: activeSection === s.id ? C.primary : C.textMuted,
                fontSize: 11,
                fontFamily: "'IBM Plex Mono', monospace",
                fontWeight: 600,
                letterSpacing: '0.04em',
                textAlign: 'left',
                borderLeft: activeSection === s.id ? `2px solid ${C.primary}` : '2px solid transparent',
              }}
            >
              {s.icon} {s.label}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}`, fontFamily: "'IBM Plex Mono', monospace" }}
        >
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>UPTIME</div>
          <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{uptime}</div>
          <div style={{ fontSize: 10, color: C.textDim, marginTop: 6 }}>{timeStr}</div>
          <div
            style={{
              marginTop: 8,
              padding: '5px 8px',
              borderRadius: 3,
              backgroundColor: C.amberDim,
              border: `1px solid ${C.amberMid}`,
              fontSize: 10,
              color: C.amber,
              fontWeight: 600,
            }}
          >
            ⚠ LOCAL ACCESS ONLY
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Top bar */}
        <div
          style={{
            padding: '10px 20px',
            borderBottom: `1px solid ${C.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            backgroundColor: C.bgPanel,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14, fontFamily: "'Outfit', sans-serif" }}>
            {sections.find((s) => s.id === activeSection)?.label}
          </span>
          <div style={{ flex: 1 }} />
          <Tag color={C.green} bg={C.greenDim} border={C.greenMid}>
            <Lock /> TLS Active
          </Tag>
          <Tag color={C.primary} bg={C.primaryDim} border={C.primaryMid}>
            WireGuard
          </Tag>
          <Tag color={C.textMuted}>v0.1.0</Tag>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {/* ===== OVERVIEW ===== */}
          {activeSection === 'overview' && (
            <>
              {/* Metrics row */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <Metric
                  label="Messages Routed"
                  value="847"
                  sub="Today · 12,403 total"
                  color={C.primary}
                  icon={<Activity />}
                />
                <Metric label="Active Sessions" value="2" sub="1 human · 1 AI" color={C.green} icon={<Users />} />
                <Metric
                  label="Challenges Issued"
                  value="12"
                  sub="Last 30 days · 66.7% accepted"
                  color={C.amber}
                  icon={<ShieldIcon />}
                />
                <Metric label="Rejected Connections" value="1" sub="Last 24 hours" color={C.red} icon={<Ban />} />
              </div>

              {/* Two column layout */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* Session health */}
                <div
                  style={{
                    backgroundColor: C.bgCard,
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      padding: '12px 16px',
                      borderBottom: `1px solid ${C.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Zap />
                    <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
                      ACTIVE SESSIONS
                    </span>
                  </div>
                  {[
                    { name: 'Human Client', ip: '10.0.10.5', jwt: 'exp 14:30:00', latency: '2ms', status: 'healthy' },
                    {
                      name: 'AI Client (Claude Opus)',
                      ip: '10.0.50.10',
                      jwt: 'exp 14:30:00',
                      latency: '1ms',
                      status: 'healthy',
                    },
                  ].map((s, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '12px 16px',
                        borderBottom: `1px solid ${C.border}08`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <StatusPulse status={s.status} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{s.name}</div>
                        <div
                          style={{
                            fontSize: 10,
                            color: C.textDim,
                            fontFamily: "'IBM Plex Mono', monospace",
                            marginTop: 2,
                          }}
                        >
                          {s.ip} · JWT {s.jwt} · {s.latency}
                        </div>
                      </div>
                      <Tag color={C.green} bg={C.greenDim} border={C.greenMid}>
                        {s.status}
                      </Tag>
                    </div>
                  ))}
                </div>

                {/* Relay health */}
                <div
                  style={{
                    backgroundColor: C.bgCard,
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      padding: '12px 16px',
                      borderBottom: `1px solid ${C.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Server />
                    <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
                      RELAY HEALTH
                    </span>
                  </div>
                  {[
                    { metric: 'WebSocket', value: 'Active', status: 'ok' },
                    { metric: 'TLS Certificate', value: 'Valid · 187 days', status: 'ok' },
                    { metric: 'Audit Log', value: '12,403 entries · 48MB', status: 'ok' },
                    { metric: 'Quarantine Store', value: '1 file · 3.2 KB', status: 'ok' },
                    { metric: 'Disk Usage', value: '2.1 GB / 20 GB', status: 'ok' },
                    { metric: 'Memory', value: '128 MB / 512 MB', status: 'ok' },
                  ].map((h, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '8px 16px',
                        borderBottom: `1px solid ${C.border}08`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: 12,
                      }}
                    >
                      <span
                        style={{ flex: 1, color: C.textMuted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}
                      >
                        {h.metric}
                      </span>
                      <span style={{ color: C.text, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                        {h.value}
                      </span>
                      <span style={{ color: C.green, fontSize: 10 }}>
                        <CheckCircle />
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent connections */}
              <div
                style={{
                  marginTop: 12,
                  backgroundColor: C.bgCard,
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '12px 16px',
                    borderBottom: `1px solid ${C.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Terminal />
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
                    RECENT ACTIVITY
                  </span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: C.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>
                    Last 10 events
                  </span>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '70px 120px 1fr 100px 80px',
                    padding: '8px 16px',
                    borderBottom: `1px solid ${C.border}`,
                    fontSize: 10,
                    color: C.textDim,
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  <span>TIME</span>
                  <span>SOURCE</span>
                  <span>DETAIL</span>
                  <span>RESULT</span>
                  <span>LATENCY</span>
                </div>
                {CONNECTIONS.slice(0, 5).map((c, i) => (
                  <ConnectionEntry key={i} entry={c} />
                ))}
              </div>
            </>
          )}

          {/* ===== PROVIDERS ===== */}
          {activeSection === 'providers' && (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <Metric
                  label="Approved Providers"
                  value="1"
                  sub="Allowlist model — explicit approval only"
                  color={C.primary}
                  icon={<Users />}
                />
                <Metric
                  label="Pending Requests"
                  value="0"
                  sub="No unapproved requests"
                  color={C.textDim}
                  icon={<Clock />}
                />
                <Metric label="Revoked" value="0" sub="All time" color={C.red} icon={<XCircle />} />
              </div>

              {/* Active providers */}
              <div
                style={{
                  backgroundColor: C.bgCard,
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  overflow: 'hidden',
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    padding: '12px 16px',
                    borderBottom: `1px solid ${C.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <CheckCircle />
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
                    APPROVED PROVIDERS
                  </span>
                  <div style={{ flex: 1 }} />
                  <button
                    style={{
                      padding: '5px 12px',
                      borderRadius: 3,
                      border: `1px solid ${C.primaryMid}`,
                      backgroundColor: C.primaryDim,
                      color: C.primary,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: "'IBM Plex Mono', monospace",
                    }}
                  >
                    + ADD PROVIDER
                  </button>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 120px 120px 100px 140px 80px',
                    padding: '8px 16px',
                    borderBottom: `1px solid ${C.border}`,
                    fontSize: 10,
                    color: C.textDim,
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  <span>PROVIDER</span>
                  <span>STATUS</span>
                  <span>MODEL</span>
                  <span>SESSIONS</span>
                  <span>LAST SEEN</span>
                  <span>ACTION</span>
                </div>
                {PROVIDERS.map((p, i) => (
                  <ProviderRow key={i} provider={p} />
                ))}
              </div>

              {/* Provider capabilities */}
              <div
                style={{
                  backgroundColor: C.bgCard,
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '12px 16px',
                    borderBottom: `1px solid ${C.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <ShieldIcon />
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
                    CAPABILITY MATRIX — Anthropic Claude
                  </span>
                </div>
                {[
                  { cap: 'Send conversation messages', granted: true },
                  { cap: 'Send task messages', granted: true },
                  { cap: 'Issue challenge messages', granted: true },
                  { cap: 'Issue denial messages', granted: true },
                  { cap: 'Send file-offer messages', granted: true },
                  { cap: 'Receive file transfers', granted: true },
                  { cap: 'Request configuration changes', granted: false },
                  { cap: 'Access audit log', granted: false },
                  { cap: 'Modify safety parameters', granted: false },
                ].map((c, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 16px',
                      borderBottom: `1px solid ${C.border}08`,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: c.granted ? C.green : C.red }}>
                      {c.granted ? <CheckCircle /> : <XCircle />}
                    </span>
                    <span style={{ color: C.text, flex: 1 }}>{c.cap}</span>
                    <Tag
                      color={c.granted ? C.green : C.red}
                      bg={c.granted ? C.greenDim : C.redDim}
                      border={c.granted ? C.greenMid : C.redMid}
                    >
                      {c.granted ? 'GRANTED' : 'DENIED'}
                    </Tag>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ===== BLOCKLIST ===== */}
          {activeSection === 'blocklist' && (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <Metric
                  label="Blocked Patterns"
                  value={BLOCKLIST.length.toString()}
                  sub="4 locked (MaliClaw Clause)"
                  color={C.red}
                  icon={<Ban />}
                />
                <Metric
                  label="Total Rejections"
                  value="0"
                  sub="No attempts yet"
                  color={C.textDim}
                  icon={<ShieldIcon />}
                />
                <Metric
                  label="Blocklist Version"
                  value="1.0.0"
                  sub="Last updated: March 2026"
                  color={C.primary}
                  icon={<Database />}
                />
              </div>

              {/* MaliClaw Clause */}
              <div
                style={{
                  padding: 16,
                  borderRadius: 6,
                  backgroundColor: C.redDim,
                  border: `1px solid ${C.redMid}`,
                  marginBottom: 16,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Ban />
                  <span
                    style={{ fontWeight: 700, fontSize: 14, color: C.red, fontFamily: "'IBM Plex Mono', monospace" }}
                  >
                    THE MALICLAW CLAUSE
                  </span>
                  <Tag color={C.red} bg={C.redDim} border={C.redMid}>
                    <Lock /> NON-NEGOTIABLE
                  </Tag>
                </div>
                <div style={{ fontSize: 12, color: C.text, lineHeight: 1.6, marginBottom: 8 }}>
                  The following patterns are permanently blocked at the TLS handshake level. These entries cannot be
                  removed, modified, or bypassed through any configuration path. They exist as a non-negotiable
                  statement of this project's security standards.
                </div>
                <div style={{ fontSize: 11, color: C.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>
                  Enforcement: Pre-authentication · Layer: TLS · Override: None · Source: Hardcoded
                </div>
              </div>

              {/* Blocklist entries */}
              <div
                style={{
                  backgroundColor: C.bgCard,
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  overflow: 'hidden',
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    padding: '12px 16px',
                    borderBottom: `1px solid ${C.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
                    PERMANENT ENTRIES
                  </span>
                </div>
                {BLOCKLIST.map((b, i) => (
                  <BlockEntry key={i} entry={b} />
                ))}
              </div>

              {/* Custom blocklist */}
              <div
                style={{
                  backgroundColor: C.bgCard,
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '12px 16px',
                    borderBottom: `1px solid ${C.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
                    CUSTOM ENTRIES
                  </span>
                  <div style={{ flex: 1 }} />
                  <button
                    style={{
                      padding: '5px 12px',
                      borderRadius: 3,
                      border: `1px solid ${C.primaryMid}`,
                      backgroundColor: C.primaryDim,
                      color: C.primary,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: "'IBM Plex Mono', monospace",
                    }}
                  >
                    + ADD PATTERN
                  </button>
                </div>
                <div
                  style={{
                    padding: 20,
                    textAlign: 'center',
                    color: C.textDim,
                    fontSize: 12,
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  No custom blocklist entries. The allowlist model means unapproved clients are rejected by default —
                  custom blocks are for additional pattern matching on known threats.
                </div>
              </div>
            </>
          )}

          {/* ===== QUARANTINE ===== */}
          {activeSection === 'quarantine' && (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <Metric
                  label="Inbound Quarantine"
                  value={QUARANTINE_STATS.inbound.current.toString()}
                  sub={`${QUARANTINE_STATS.inbound.total} processed total`}
                  color={C.green}
                  icon={<Database />}
                />
                <Metric
                  label="Outbound Quarantine"
                  value={QUARANTINE_STATS.outbound.current.toString()}
                  sub={`${QUARANTINE_STATS.outbound.total} processed total`}
                  color={C.primary}
                  icon={<Database />}
                />
                <Metric
                  label="Hash Mismatches"
                  value={QUARANTINE_STATS.hashMismatches.toString()}
                  sub="Integrity verified"
                  color={C.green}
                  icon={<ShieldIcon />}
                />
                <Metric
                  label="Rejected Transfers"
                  value={QUARANTINE_STATS.rejected.current.toString()}
                  sub="All time"
                  color={C.textDim}
                  icon={<XCircle />}
                />
              </div>

              {/* Currently quarantined */}
              <div
                style={{
                  backgroundColor: C.bgCard,
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  overflow: 'hidden',
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    padding: '12px 16px',
                    borderBottom: `1px solid ${C.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
                    CURRENTLY QUARANTINED
                  </span>
                  <Tag color={C.amber} bg={C.amberDim} border={C.amberMid}>
                    1 file
                  </Tag>
                </div>
                <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 4,
                      backgroundColor: C.amberDim,
                      border: `1px solid ${C.amberMid}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: C.amber,
                    }}
                  >
                    <Database />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: "'IBM Plex Mono', monospace" }}
                    >
                      nginx-audit-report.md
                    </div>
                    <div
                      style={{ fontSize: 10, color: C.textDim, fontFamily: "'IBM Plex Mono', monospace", marginTop: 2 }}
                    >
                      Direction: outbound · Size: 3.2 KB · Encrypted: yes · Hash: c9a1f2...d4e7
                    </div>
                  </div>
                  <Tag color={C.amber} bg={C.amberDim} border={C.amberMid}>
                    AWAITING HUMAN APPROVAL
                  </Tag>
                </div>
              </div>

              {/* Quarantine policy */}
              <div
                style={{
                  backgroundColor: C.bgCard,
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '12px 16px',
                    borderBottom: `1px solid ${C.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
                    QUARANTINE POLICY
                  </span>
                  <Tag color={C.red} bg={C.redDim} border={C.redMid}>
                    <Lock /> LOCKED
                  </Tag>
                </div>
                {[
                  { policy: 'All files quarantined before transfer', value: 'Enforced', locked: true },
                  { policy: 'Hash verification at every stage', value: 'Enforced', locked: true },
                  { policy: 'Automatic purge on completion/timeout', value: 'Enabled · 1 hour timeout', locked: false },
                  { policy: 'Maximum file size', value: '50 MB', locked: false },
                  { policy: 'Allowed MIME types', value: 'text/*, application/json, application/pdf', locked: false },
                  { policy: 'E2E encryption required', value: 'Enforced', locked: true },
                ].map((p, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 16px',
                      borderBottom: `1px solid ${C.border}08`,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ flex: 1, color: C.textMuted }}>{p.policy}</span>
                    <span style={{ color: C.text, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                      {p.value}
                    </span>
                    {p.locked && (
                      <Tag color={C.red} bg={C.redDim} border={C.redMid}>
                        <Lock /> LOCKED
                      </Tag>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ===== CONNECTIONS ===== */}
          {activeSection === 'connections' && (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <Metric
                  label="Total Connections"
                  value="847"
                  sub="Last 24 hours"
                  color={C.primary}
                  icon={<Activity />}
                />
                <Metric label="Accepted" value="846" sub="99.9%" color={C.green} icon={<CheckCircle />} />
                <Metric label="Rejected" value="1" sub="0.1%" color={C.red} icon={<XCircle />} />
                <Metric
                  label="Avg Latency"
                  value="1.7ms"
                  sub="Relay processing time"
                  color={C.primary}
                  icon={<Zap />}
                />
              </div>

              <div
                style={{
                  backgroundColor: C.bgCard,
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '12px 16px',
                    borderBottom: `1px solid ${C.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Terminal />
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
                    CONNECTION LOG
                  </span>
                  <div style={{ flex: 1 }} />
                  <div style={{ display: 'flex', gap: 4 }}>
                    {['all', 'accepted', 'rejected'].map((f) => (
                      <button
                        key={f}
                        style={{
                          padding: '3px 8px',
                          borderRadius: 3,
                          border: `1px solid ${C.border}`,
                          backgroundColor: f === 'all' ? C.bgHover : 'transparent',
                          color: f === 'all' ? C.text : C.textDim,
                          fontSize: 10,
                          cursor: 'pointer',
                          fontFamily: "'IBM Plex Mono', monospace",
                        }}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '70px 120px 1fr 100px 80px',
                    padding: '8px 16px',
                    borderBottom: `1px solid ${C.border}`,
                    fontSize: 10,
                    color: C.textDim,
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  <span>TIME</span>
                  <span>SOURCE</span>
                  <span>DETAIL</span>
                  <span>RESULT</span>
                  <span>LATENCY</span>
                </div>
                {CONNECTIONS.map((c, i) => (
                  <ConnectionEntry key={i} entry={c} />
                ))}
              </div>
            </>
          )}

          {/* ===== SYSTEM ===== */}
          {activeSection === 'system' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* Relay config */}
                <div
                  style={{
                    backgroundColor: C.bgCard,
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      padding: '12px 16px',
                      borderBottom: `1px solid ${C.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Server />
                    <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
                      RELAY CONFIGURATION
                    </span>
                  </div>
                  {[
                    { key: 'Hostname', value: 'naval-bastion-01' },
                    { key: 'Listen Address', value: 'wss://10.0.30.5:8443' },
                    { key: 'External Address', value: 'wss://bastion.glorktelligence.co.uk' },
                    { key: 'Protocol Version', value: '0.1.0' },
                    { key: 'TLS Certificate', value: "Let's Encrypt · *.glorktelligence.co.uk" },
                    { key: 'JWT Expiry', value: '900s (15 min)' },
                    { key: 'Heartbeat Interval', value: '30s' },
                    { key: 'Heartbeat Timeout', value: '90s (3 missed = alert)' },
                    { key: 'Max Message Size', value: '1 MB' },
                    { key: 'Access', value: 'WireGuard VPN + Local network only' },
                  ].map((c, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '8px 16px',
                        borderBottom: `1px solid ${C.border}08`,
                        fontSize: 12,
                      }}
                    >
                      <span
                        style={{ flex: 1, color: C.textMuted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}
                      >
                        {c.key}
                      </span>
                      <span style={{ color: C.text, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                        {c.value}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Audit log config */}
                <div
                  style={{
                    backgroundColor: C.bgCard,
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      padding: '12px 16px',
                      borderBottom: `1px solid ${C.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Database />
                    <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
                      AUDIT LOG CONFIGURATION
                    </span>
                  </div>
                  {[
                    { key: 'Storage Backend', value: 'SQLite' },
                    { key: 'Database Path', value: '/var/lib/bastion/audit.db' },
                    { key: 'Current Size', value: '48 MB · 12,403 entries' },
                    { key: 'Retention Policy', value: '365 days' },
                    { key: 'Append-Only Mode', value: 'Enforced' },
                    { key: 'Tamper Detection', value: 'SHA-256 chain' },
                    { key: 'Backup Schedule', value: 'Daily · naval-backup-01' },
                    { key: 'Compression', value: 'Enabled (zstd)' },
                  ].map((c, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '8px 16px',
                        borderBottom: `1px solid ${C.border}08`,
                        fontSize: 12,
                      }}
                    >
                      <span
                        style={{ flex: 1, color: C.textMuted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}
                      >
                        {c.key}
                      </span>
                      <span style={{ color: C.text, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                        {c.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Network topology */}
              <div
                style={{
                  marginTop: 12,
                  backgroundColor: C.bgCard,
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '12px 16px',
                    borderBottom: `1px solid ${C.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Activity />
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
                    NETWORK TOPOLOGY
                  </span>
                </div>
                <div style={{ padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
                  {/* Human client */}
                  <div style={{ textAlign: 'center' }}>
                    <div
                      style={{
                        width: 80,
                        height: 80,
                        borderRadius: 8,
                        backgroundColor: C.bgPanel,
                        border: `2px solid ${C.accent}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <span style={{ fontSize: 20 }}>👤</span>
                      <span
                        style={{
                          fontSize: 9,
                          color: C.accent,
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontWeight: 600,
                        }}
                      >
                        HUMAN
                      </span>
                    </div>
                    <div
                      style={{ fontSize: 10, color: C.textDim, fontFamily: "'IBM Plex Mono', monospace", marginTop: 6 }}
                    >
                      10.0.10.5
                    </div>
                    <div style={{ fontSize: 9, color: C.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>
                      VLAN 10
                    </div>
                  </div>

                  {/* Arrow */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div
                      style={{
                        fontSize: 10,
                        color: C.green,
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontWeight: 600,
                      }}
                    >
                      WSS
                    </div>
                    <div style={{ width: 60, height: 2, backgroundColor: C.green, position: 'relative' }}>
                      <div
                        style={{
                          position: 'absolute',
                          right: -4,
                          top: -3,
                          width: 0,
                          height: 0,
                          borderLeft: `6px solid ${C.green}`,
                          borderTop: '4px solid transparent',
                          borderBottom: '4px solid transparent',
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 9, color: C.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>E2E</div>
                  </div>

                  {/* Relay */}
                  <div style={{ textAlign: 'center' }}>
                    <div
                      style={{
                        width: 100,
                        height: 80,
                        borderRadius: 8,
                        backgroundColor: C.bgPanel,
                        border: `2px solid ${C.primary}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <span style={{ fontSize: 20 }}>🏰</span>
                      <span
                        style={{
                          fontSize: 9,
                          color: C.primary,
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontWeight: 600,
                        }}
                      >
                        RELAY
                      </span>
                    </div>
                    <div
                      style={{ fontSize: 10, color: C.textDim, fontFamily: "'IBM Plex Mono', monospace", marginTop: 6 }}
                    >
                      10.0.30.5
                    </div>
                    <div style={{ fontSize: 9, color: C.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>
                      VLAN 30 · DMZ
                    </div>
                  </div>

                  {/* Arrow */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div
                      style={{
                        fontSize: 10,
                        color: C.green,
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontWeight: 600,
                      }}
                    >
                      WSS
                    </div>
                    <div style={{ width: 60, height: 2, backgroundColor: C.green, position: 'relative' }}>
                      <div
                        style={{
                          position: 'absolute',
                          right: -4,
                          top: -3,
                          width: 0,
                          height: 0,
                          borderLeft: `6px solid ${C.green}`,
                          borderTop: '4px solid transparent',
                          borderBottom: '4px solid transparent',
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 9, color: C.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>E2E</div>
                  </div>

                  {/* AI VM */}
                  <div style={{ textAlign: 'center' }}>
                    <div
                      style={{
                        width: 80,
                        height: 80,
                        borderRadius: 8,
                        backgroundColor: C.bgPanel,
                        border: `2px solid ${C.amber}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <span style={{ fontSize: 20 }}>🤖</span>
                      <span
                        style={{
                          fontSize: 9,
                          color: C.amber,
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontWeight: 600,
                        }}
                      >
                        AI VM
                      </span>
                    </div>
                    <div
                      style={{ fontSize: 10, color: C.textDim, fontFamily: "'IBM Plex Mono', monospace", marginTop: 6 }}
                    >
                      10.0.50.10
                    </div>
                    <div style={{ fontSize: 9, color: C.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>
                      VLAN 50 · ISOLATED
                    </div>
                  </div>

                  {/* Arrow to provider */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div
                      style={{
                        fontSize: 10,
                        color: C.amber,
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontWeight: 600,
                      }}
                    >
                      API
                    </div>
                    <div style={{ width: 60, height: 2, backgroundColor: C.amber, position: 'relative' }}>
                      <div
                        style={{
                          position: 'absolute',
                          right: -4,
                          top: -3,
                          width: 0,
                          height: 0,
                          borderLeft: `6px solid ${C.amber}`,
                          borderTop: '4px solid transparent',
                          borderBottom: '4px solid transparent',
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 9, color: C.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>TLS</div>
                  </div>

                  {/* Provider */}
                  <div style={{ textAlign: 'center' }}>
                    <div
                      style={{
                        width: 80,
                        height: 80,
                        borderRadius: 8,
                        backgroundColor: C.bgPanel,
                        border: `2px dashed ${C.textDim}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <span style={{ fontSize: 20 }}>☁️</span>
                      <span
                        style={{
                          fontSize: 9,
                          color: C.textDim,
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontWeight: 600,
                        }}
                      >
                        PROVIDER
                      </span>
                    </div>
                    <div
                      style={{ fontSize: 10, color: C.textDim, fontFamily: "'IBM Plex Mono', monospace", marginTop: 6 }}
                    >
                      api.anthropic.com
                    </div>
                    <div style={{ fontSize: 9, color: C.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>
                      EXTERNAL
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    padding: '10px 16px',
                    borderTop: `1px solid ${C.border}`,
                    fontSize: 10,
                    color: C.textDim,
                    fontFamily: "'IBM Plex Mono', monospace",
                    textAlign: 'center',
                  }}
                >
                  Firewall: OPNSense (Mystic) · Inter-VLAN rules: Bastion protocol only · AI VM: No lateral movement ·
                  API key: Never leaves VLAN 50
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
