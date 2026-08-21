export const ICONS={
'ti-chevron-left':'<path d="M15 6l-6 6 6 6"/>',
'ti-chevron-right':'<path d="M9 6l6 6-6 6"/>',
'ti-arrow-down-right':'<path d="M7 7l10 10M17 9v8h-8"/>',
'ti-moon':'<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
'ti-pencil-plus':'<path d="M4 20h4L18 10a2.8 2.8 0 0 0-4-4L4 16v4M13.5 6.5l4 4M16 19h6M19 16v6"/>',
'ti-list':'<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
'ti-shield-check':'<path d="M12 3l7 3v6c0 4-3 7.2-7 9-4-1.8-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
'ti-download':'<path d="M12 4v11M8 11l4 4 4-4M5 19h14"/>',
'ti-trash':'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
'ti-x':'<path d="M6 6l12 12M18 6L6 18"/>',
'ti-plus':'<path d="M12 5v14M5 12h14"/>',
'ti-flame':'<path d="M12 2c3 4 5 6.5 5 9.5a5 5 0 0 1-10 0c0-2 .8-3.2 2-4.2 0 2 1 3 2 3s-2-4.8 1-8.3z"/>',
'ti-calendar-month':'<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"/>',
'ti-adjustments':'<path d="M5 6h8M18 6h1M5 12h3M13 12h6M5 18h8M18 18h1M13 4v4M8 10v4M13 16v4"/>',
'ti-lock':'<path d="M6 11h12v9H6zM9 11V7.5a3 3 0 0 1 6 0V11"/>',
'ti-coin':'<circle cx="12" cy="12" r="9"/><path d="M14.5 9H11a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9.5M12 7v10"/>',
'ti-info-circle':'<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>',
'ti-chart-donut':'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v5M19.8 15.5l-4.7-1.6"/>',
'ti-check':'<path d="M5 12l5 5L20 7"/>',
'ti-bowl':'<path d="M3 11h18a9 9 0 0 1-18 0zM7 8c0-2 1.5-2.5 2.5-3.5M12 8c0-2 1.5-2.5 2.5-3.5"/>',
'ti-shopping-cart':'<circle cx="8" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/><path d="M3 4h2l2.4 10.5h10L20 7H6"/>',
'ti-shopping-bag':'<path d="M6 8h12l-1 12H7zM9 8V6a3 3 0 0 1 6 0v2"/>',
'ti-parking':'<path d="M8 20V4h4.5a4.5 4.5 0 0 1 0 9H8"/>',
'ti-gas-station':'<path d="M4 20V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v15M3 20h12M6 8h5M13 10h3a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V9l-3-3"/>',
'ti-chart-line':'<path d="M4 4v16h16"/><path d="M7 15l4-5 3 3 5-7"/>',
'ti-activity':'<path d="M3 12h4l3 7 4-14 3 7h4"/>',
'ti-target':'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
'ti-archive':'<path d="M3 6h18v3H3zM5 9v11h14V9M10 13h4"/>',
'ti-repeat':'<path d="M4 10V8a3 3 0 0 1 3-3h10l-3-3M20 14v2a3 3 0 0 1-3 3H7l3 3"/>',
'ti-calendar-plus':'<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M12 13v4M10 15h4"/>',
'ti-dots':'<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'
};

export function paintIcons(){
  document.querySelectorAll('i.ti').forEach(el=>{
    if(el.dataset.ico)return;
    let name=null;
    el.classList.forEach(c=>{if(ICONS[c])name=c;});
    if(!name)return;
    el.dataset.ico='1';
    el.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+ICONS[name]+'</svg>';
  });
}
