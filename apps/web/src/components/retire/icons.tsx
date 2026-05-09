import type { SVGProps } from 'react';

type IconName =
  | 'home' | 'sliders' | 'wallet' | 'chart' | 'flask' | 'globe' | 'gear'
  | 'chevron-l' | 'chevron-r' | 'chevron-d'
  | 'plus' | 'refresh' | 'download' | 'edit' | 'trash' | 'check'
  | 'arrow-up' | 'arrow-down';

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  const props: SVGProps<SVGSVGElement> = {
    width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.5,
    strokeLinecap: 'round', strokeLinejoin: 'round',
    ...rest,
  };
  switch (name) {
    case 'home':       return <svg {...props}><path d="M2.5 7L8 2.5 13.5 7v6a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V7Z"/><path d="M6.5 13.5V9h3v4.5"/></svg>;
    case 'sliders':    return <svg {...props}><path d="M2 4h6M10 4h4M2 8h2M6 8h8M2 12h8M12 12h2"/><circle cx="9" cy="4" r="1.3"/><circle cx="5" cy="8" r="1.3"/><circle cx="11" cy="12" r="1.3"/></svg>;
    case 'wallet':     return <svg {...props}><rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2 6h12M11 9.5h1.5"/></svg>;
    case 'chart':      return <svg {...props}><path d="M2 13h12"/><path d="M3 11V8M6 11V5M9 11V7M12 11V3"/></svg>;
    case 'flask':      return <svg {...props}><path d="M6 2v4L3 12.5a1 1 0 0 0 .9 1.5h8.2a1 1 0 0 0 .9-1.5L10 6V2"/><path d="M5 2h6"/><path d="M4.5 10h7"/></svg>;
    case 'globe':      return <svg {...props}><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/></svg>;
    case 'gear':       return <svg {...props}><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M1 8h2M13 8h2M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"/></svg>;
    case 'chevron-l':  return <svg {...props}><path d="M9.5 4 6 8l3.5 4"/></svg>;
    case 'chevron-r':  return <svg {...props}><path d="M6.5 4 10 8l-3.5 4"/></svg>;
    case 'chevron-d':  return <svg {...props}><path d="m4 6 4 4 4-4"/></svg>;
    case 'plus':       return <svg {...props}><path d="M8 3v10M3 8h10"/></svg>;
    case 'refresh':    return <svg {...props}><path d="M13 3v3.5h-3.5"/><path d="M13 6.5A5.5 5.5 0 1 0 14 9"/></svg>;
    case 'download':   return <svg {...props}><path d="M8 2v8m-3-3 3 3 3-3M3 13h10"/></svg>;
    case 'edit':       return <svg {...props}><path d="M11 2.5 13.5 5 6 12.5l-3.5.5.5-3.5L11 2.5Z"/></svg>;
    case 'trash':      return <svg {...props}><path d="M3 4h10M5.5 4V2.5h5V4M4 4l.5 9h7l.5-9M6.5 6.5v5M9.5 6.5v5"/></svg>;
    case 'check':      return <svg {...props}><path d="m3 8.5 3 3 7-7"/></svg>;
    case 'arrow-up':   return <svg {...props}><path d="M8 13V3M4 7l4-4 4 4"/></svg>;
    case 'arrow-down': return <svg {...props}><path d="M8 3v10M4 9l4 4 4-4"/></svg>;
  }
}

export type { IconName };
