"use client";

import { Icon, type IconName } from './icons';

export type PageId = 'overview' | 'plan' | 'accounts' | 'projections' | 'decisions' | 'assumptions' | 'settings';

const NAV: { section: string; items: { id: PageId; label: string; icon: IconName }[] }[] = [
  { section: 'Plan', items: [
    { id: 'overview', label: 'Overview', icon: 'home' },
    { id: 'plan', label: 'Plan', icon: 'sliders' },
    { id: 'accounts', label: 'Accounts', icon: 'wallet' },
  ]},
  { section: 'Analyze', items: [
    { id: 'projections', label: 'Projections', icon: 'chart' },
    { id: 'decisions', label: 'Decisions', icon: 'flask' },
    { id: 'assumptions', label: 'Assumptions', icon: 'globe' },
  ]},
  { section: 'Account', items: [
    { id: 'settings', label: 'Settings', icon: 'gear' },
  ]},
];

export function Sidebar({
  active, onNav, collapsed, onToggleCollapsed, userName, userEmail,
}: {
  active: PageId;
  onNav: (id: PageId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  userName: string;
  userEmail: string;
}) {
  const initials = userName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?';
  return (
    <aside className="sb">
      <div className="sb-head">
        <div className="sb-logo"><span>R</span></div>
        <div className="sb-brand">
          <b>Retire</b>
          <small>v3.0</small>
        </div>
        <button className="sb-collapse" onClick={onToggleCollapsed} title={collapsed ? 'Expand' : 'Collapse'} type="button">
          <Icon name="chevron-l" width={11} height={11} />
        </button>
      </div>

      {NAV.map(sec => (
        <div className="sb-section" key={sec.section}>
          <div className="sb-section-label">{sec.section}</div>
          {sec.items.map(item => (
            <button
              key={item.id}
              type="button"
              className="sb-item"
              data-active={active === item.id}
              onClick={() => onNav(item.id)}
              title={item.label}
            >
              <span className="ico"><Icon name={item.icon} /></span>
              <span className="lbl">{item.label}</span>
            </button>
          ))}
        </div>
      ))}

      <div className="sb-foot">
        <div className="sb-user">
          <div className="sb-avatar">{initials}</div>
          <div className="sb-foot-meta">
            <b>{userName}</b>
            <small>{userEmail}</small>
          </div>
        </div>
      </div>
    </aside>
  );
}
