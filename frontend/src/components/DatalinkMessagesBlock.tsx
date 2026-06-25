'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '@/lib/api';

type DatalinkMessage = {
  id: number;
  timestamp?: string;
  label?: string;
  text?: string;
  source_type?: string;
};

const PRIORITY_POLL_MS = 3_000;
const PRIORITY_POLL_MAX_MS = 45_000;

function formatDatalinkTime(value?: string): string {
  if (!value) return '--:--';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value.slice(11, 16) || value;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '--:--';
  }
}

export default function DatalinkMessagesBlock({
  icao24,
  registration,
  callsign,
}: {
  icao24?: string;
  registration?: string;
  callsign?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<DatalinkMessage[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [priorityScanning, setPriorityScanning] = useState(false);
  const pollUntilRef = useRef(0);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (icao24) params.set('icao24', icao24);
    if (registration) params.set('registration', registration);
    if (callsign) params.set('callsign', callsign);
    return params;
  }, [icao24, registration, callsign]);

  const fetchDatalink = useCallback(
    async (opts?: { showLoading?: boolean }) => {
      const params = buildParams();
      if ([...params.keys()].length === 0) {
        setLoading(false);
        return;
      }

      if (opts?.showLoading) {
        setLoading(true);
        setLoadError(null);
      }

      try {
        const res = await fetch(`${API_BASE}/api/aviation/datalink/messages?${params.toString()}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`datalink ${res.status}`);
        const json = await res.json();
        setConfigured(Boolean(json.configured));
        setMessages(Array.isArray(json.messages) ? json.messages : []);
        setHint(typeof json.hint === 'string' ? json.hint : null);
        setLoadError(null);
        if (json.priority_scan || json.queued_refresh) {
          setPriorityScanning(true);
          pollUntilRef.current = Date.now() + PRIORITY_POLL_MAX_MS;
        }
        if (Array.isArray(json.messages) && json.messages.length > 0) {
          setPriorityScanning(false);
        }
      } catch {
        if (opts?.showLoading) {
          setConfigured(null);
          setMessages([]);
          setLoadError('Could not reach ACARS cache. Try again in a moment.');
        }
      } finally {
        if (opts?.showLoading) setLoading(false);
      }
    },
    [buildParams],
  );

  useEffect(() => {
    pollUntilRef.current = 0;
    setPriorityScanning(false);
    void fetchDatalink({ showLoading: true });
  }, [fetchDatalink]);

  useEffect(() => {
    if (!priorityScanning) return;

    const intervalId = window.setInterval(() => {
      if (Date.now() > pollUntilRef.current) {
        setPriorityScanning(false);
        return;
      }
      void fetchDatalink();
    }, PRIORITY_POLL_MS);

    return () => window.clearInterval(intervalId);
  }, [priorityScanning, fetchDatalink]);

  if (loading) {
    return (
      <div className="border-b border-[var(--border-primary)] pb-2">
        <span className="text-[var(--text-muted)] text-[10px] block mb-1">DATALINK (AIRFRAMES)</span>
        <span className="text-[10px] font-mono text-[var(--text-muted)]">Loading ACARS cache…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="border-b border-[var(--border-primary)] pb-2">
        <span className="text-[var(--text-muted)] text-[10px] block mb-1">DATALINK (AIRFRAMES)</span>
        <p className="text-[10px] font-mono text-amber-400/90 leading-relaxed">{loadError}</p>
      </div>
    );
  }

  if (configured === false) {
    return (
      <div className="border-b border-[var(--border-primary)] pb-2">
        <span className="text-[var(--text-muted)] text-[10px] block mb-1">DATALINK (AIRFRAMES)</span>
        <p className="text-[10px] font-mono text-amber-400/90 leading-relaxed">
          {hint || 'Add your Airframes API key in Settings → API Keys to enable ACARS datalink on plane dossiers.'}
        </p>
      </div>
    );
  }

  if (!messages.length) {
    return (
      <div className="border-b border-[var(--border-primary)] pb-2">
        <span className="text-[var(--text-muted)] text-[10px] block mb-1">DATALINK (AIRFRAMES)</span>
        <p className="text-[10px] font-mono text-[var(--text-muted)]">
          {priorityScanning
            ? 'Priority scan queued for this aircraft (~2s)…'
            : 'No recent ACARS/VDL messages for this aircraft.'}
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-[var(--border-primary)] pb-2">
      <span className="text-[var(--text-muted)] text-[10px] block mb-1">DATALINK (AIRFRAMES)</span>
      {priorityScanning ? (
        <p className="text-[10px] font-mono text-cyan-500/70 mb-1">Refreshing this aircraft…</p>
      ) : null}
      <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
        {messages.map((message) => (
          <div key={message.id} className="text-[10px] font-mono leading-snug border border-[var(--border-primary)]/60 bg-black/20 px-2 py-1.5">
            <div className="flex items-center gap-2 text-[var(--text-muted)] mb-0.5">
              <span>{formatDatalinkTime(message.timestamp)}</span>
              {message.label ? <span className="text-orange-400/90">{message.label}</span> : null}
              {message.source_type ? <span className="truncate">{message.source_type}</span> : null}
            </div>
            <div className="text-[var(--text-primary)] whitespace-pre-wrap break-words">{message.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
