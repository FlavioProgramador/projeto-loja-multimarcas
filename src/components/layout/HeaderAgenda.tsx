import React, { useState, useEffect, useRef } from 'react';
import { Calendar, Bell, BellOff, Clock, Plus, Trash2 } from 'lucide-react';

interface AgendaEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
}

// Helper to format date consistently in local time to YYYY-MM-DD
const getLocalDateStr = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const HeaderAgenda: React.FC = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isOpen, setIsOpen] = useState(false);
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [alertsEnabled, setAlertsEnabled] = useState(true);

  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDate, setNewEventDate] = useState('');

  const popoverRef = useRef<HTMLDivElement>(null);

  // Load from local storage
  useEffect(() => {
    const savedEvents = localStorage.getItem('@vestra-agenda');
    if (savedEvents) {
      try {
        setEvents(JSON.parse(savedEvents));
      } catch (e) {
        console.error("Failed to parse agenda events from localStorage", e);
      }
    }

    const savedAlerts = localStorage.getItem('@vestra-agenda-alerts');
    if (savedAlerts !== null) {
      setAlertsEnabled(savedAlerts === 'true');
    }
  }, []);

  // Save to local storage
  useEffect(() => {
    localStorage.setItem('@vestra-agenda', JSON.stringify(events));
  }, [events]);

  useEffect(() => {
    localStorage.setItem('@vestra-agenda-alerts', String(alertsEnabled));
  }, [alertsEnabled]);

  // Update clock every minute
  useEffect(() => {
    // Sync to the next exact minute for precision
    const now = new Date();
    const msToNextMinute = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());

    let interval: ReturnType<typeof setInterval>;

    const timeout = setTimeout(() => {
      setCurrentTime(new Date());
      interval = setInterval(() => {
        setCurrentTime(new Date());
      }, 60000);
    }, msToNextMinute);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAddEvent = () => {
    if (!newEventTitle.trim() || !newEventDate) return;

    const newEvent: AgendaEvent = {
      id: Date.now().toString(),
      title: newEventTitle.trim(),
      date: newEventDate, // It's coming from input type="date" which is YYYY-MM-DD
    };

    setEvents(prev => {
      const updated = [...prev, newEvent];
      // Sort by date nearest
      return updated.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    });

    setNewEventTitle('');
    setNewEventDate('');
  };

  const handleDelete = (id: string) => {
    setEvents(prev => prev.filter(e => e.id !== id));
  };

  // Formatting clock
  const timeStr = currentTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = currentTime.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
  const displayClock = `${dateStr} • ${timeStr}`;

  // Check for upcoming events (Today or Tomorrow)
  const isUpcoming = (eventDate: string) => {
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayStr = getLocalDateStr(today);
    const tomorrowStr = getLocalDateStr(tomorrow);

    return eventDate === todayStr || eventDate === tomorrowStr;
  };

  const hasUpcomingEvent = events.some(e => isUpcoming(e.date));
  const showAlertDot = alertsEnabled && hasUpcomingEvent;

  return (
    <div style={{ position: 'relative' }} ref={popoverRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'transparent',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          padding: '6px 12px',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          fontWeight: 600,
          position: 'relative',
          transition: 'all 0.2s ease',
          backgroundColor: isOpen ? 'var(--bg-surface-subtle)' : 'transparent'
        }}
      >
        <Clock size={15} color="var(--text-secondary)" />
        {displayClock}
        {showAlertDot && (
          <div style={{
            position: 'absolute',
            top: '-2px',
            right: '-2px',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            backgroundColor: 'var(--badge-red)',
            border: '2px solid var(--bg-surface)'
          }} />
        )}
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          width: '320px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-md)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-surface-subtle)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
              <Calendar size={16} color="var(--primary)" />
              Agenda
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '11px', color: 'var(--text-secondary)', userSelect: 'none' }}>
              {alertsEnabled ? <Bell size={12} /> : <BellOff size={12} />}
              Alertas
              <input
                type="checkbox"
                checked={alertsEnabled}
                onChange={(e) => setAlertsEnabled(e.target.checked)}
                style={{ accentColor: 'var(--primary)', cursor: 'pointer', width: '14px', height: '14px', margin: 0 }}
              />
            </label>
          </div>

          {/* Add Event Form */}
          <div style={{ padding: '16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <input
              type="text"
              placeholder="Título do lembrete..."
              value={newEventTitle}
              onChange={(e) => setNewEventTitle(e.target.value)}
              className="input"
              style={{ fontSize: '13px', padding: '8px 12px' }}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="date"
                value={newEventDate}
                onChange={(e) => setNewEventDate(e.target.value)}
                className="input"
                style={{ flex: 1, fontSize: '13px', padding: '8px 12px' }}
              />
              <button
                onClick={handleAddEvent}
                className="btn"
                style={{ padding: '0 12px', minWidth: '40px', display: 'flex', justifyContent: 'center' }}
                disabled={!newEventTitle.trim() || !newEventDate}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          {/* Events List */}
          <div style={{ maxHeight: '240px', overflowY: 'auto', padding: '8px 0' }}>
            {events.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                Nenhum compromisso agendado.
              </div>
            ) : (
              events.map((event, i) => {
                const isClose = isUpcoming(event.date);
                const [y, m, d] = event.date.split('-');
                const eventDateFormatted = `${d}/${m}/${y}`;

                return (
                  <div key={event.id} style={{
                    padding: '10px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: i < events.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    transition: 'background 0.2s',
                  }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {event.title}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: isClose ? 'var(--badge-red)' : 'var(--text-muted)', marginTop: '2px', fontWeight: isClose ? 600 : 400 }}>
                        <Calendar size={10} />
                        {eventDateFormatted} {isClose && '(Próximo)'}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(event.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '6px',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--badge-red)'; e.currentTarget.style.backgroundColor = 'var(--badge-red-bg)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                      title="Excluir"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
