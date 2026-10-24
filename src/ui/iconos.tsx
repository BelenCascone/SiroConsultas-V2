// Íconos de línea (24×24, trazo 1.7), los mismos de las pantallas aprobadas. Siempre decorativos: el texto va al lado o en aria-label.
type P = { tam?: number }
const Svg = ({ tam = 20, grosor = 1.7, children }: P & { grosor?: number; children: any }) => (
  <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={grosor} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {children}
  </svg>
)

export const Campana = (p: P) => <Svg {...p}><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5h4" /></Svg>
export const Lupa = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>
export const Mas = (p: P) => <Svg grosor={2.2} tam={18} {...p}><path d="M12 5v14M5 12h14" /></Svg>
export const Cruz = (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>
export const Tilde = (p: P) => <Svg grosor={2} {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>
export const Flecha = (p: P) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>
export const Volver = (p: P) => <Svg {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>
export const Escudo = (p: P) => <Svg {...p}><path d="M12 3 5 6v6c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6z" /><path d="m9 12 2 2 4-4" /></Svg>
export const Calendario = (p: P) => <Svg tam={16} grosor={1.8} {...p}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></Svg>
