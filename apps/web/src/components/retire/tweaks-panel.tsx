"use client";

export type SidebarStyle = 'expanded' | 'rail' | 'minimal';

export function TweaksPanel({
  sidebarStyle, onSidebarStyle, darkMode, onDarkMode,
}: {
  sidebarStyle: SidebarStyle;
  onSidebarStyle: (s: SidebarStyle) => void;
  darkMode: boolean;
  onDarkMode: (v: boolean) => void;
}) {
  return (
    <div
      className="r-tweaks"
      style={{
        background: 'var(--r-surface)',
        border: '1px solid var(--r-line)',
        borderRadius: 10,
        padding: 12,
        boxShadow: '0 12px 32px -16px rgba(0,0,0,0.20), 0 4px 12px -8px rgba(0,0,0,0.10)',
        minWidth: 220,
      }}
    >
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--r-ink-3)', marginBottom: 10 }}>
        Tweaks
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--r-ink-3)', marginBottom: 6 }}>Sidebar</div>
        <div className="r-toggle">
          {(['expanded', 'rail', 'minimal'] as const).map(opt => (
            <button
              key={opt}
              type="button"
              data-active={sidebarStyle === opt}
              onClick={() => onSidebarStyle(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, color: 'var(--r-ink-3)', marginBottom: 6 }}>Theme</div>
        <button
          type="button"
          className="r-btn"
          onClick={() => onDarkMode(!darkMode)}
          style={{ width: '100%', justifyContent: 'space-between' }}
        >
          <span>Dark mode</span>
          <span className="mono">{darkMode ? 'on' : 'off'}</span>
        </button>
      </div>
    </div>
  );
}
