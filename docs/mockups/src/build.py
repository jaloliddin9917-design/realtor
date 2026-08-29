#!/usr/bin/env python3
"""Assemble docs/mockups/*.dc.html from src/ fragments. Run: python3 src/build.py"""
import pathlib, re
SRC = pathlib.Path(__file__).resolve().parent
OUT = SRC.parent
BASE_CSS = (SRC / 'base.css').read_text()
ICONS = (SRC / 'icons.html').read_text().strip()
FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&amp;family=IBM+Plex+Mono:wght@400;500&amp;display=swap">'

NAV = [
    ('dashboard', 'i-home', 'Boshqaruv paneli', None),
    ('queue', 'i-list', 'Navbat', '38'),
    ('properties', 'i-building', 'Uylar', None),
    ('duplicates', 'i-copy', 'Dublikatlar', '12'),
    ('bot', 'i-bot', 'Bot', '3'),
    ('settings', 'i-sliders', 'Sozlamalar', None),
]

def icon(name, cls='ico'):
    return f'<svg class="{cls}"><use href="#{name}"></use></svg>'

def nav(active):
    items = []
    for key, ico, label, badge in NAV:
        on = ' on' if key == active else ''
        b = f'<span class="nav-badge">{badge}</span>' if badge else ''
        items.append(f'<a class="nav-item{on}" href="#">{icon(ico)}<span style="flex:1">{label}</span>{b}</a>')
    return f'''<nav style="width:224px;flex:none;background:#15211e;color:#c9d6d2;display:flex;flex-direction:column;padding:16px 12px;gap:4px">
  <div style="display:flex;align-items:center;gap:10px;padding:6px 10px 18px">
    <div style="width:32px;height:32px;border-radius:8px;background:#0f6e63;display:flex;align-items:center;justify-content:center;color:#fff;flex:none">{icon('i-building','ico-16')}</div>
    <div><div style="font-weight:700;color:#fff;font-size:15px;letter-spacing:-.01em">Realtor CRM</div><div style="font-size:11px;color:#8fa39d">Toshkent · 4 agent</div></div>
  </div>
  {''.join(items)}
  <div style="flex:1"></div>
  <div style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;background:rgba(255,255,255,.06)">
    <span class="avatar av-s" style="background:#0f6e63">S</span>
    <div style="min-width:0"><div style="color:#fff;font-weight:600;font-size:13px">Sardor</div><div style="font-size:11px;color:#8fa39d">admin · jamoa rahbari</div></div>
  </div>
</nav>'''

def topbar(title):
    return f'''<header style="height:56px;flex:none;display:flex;align-items:center;gap:16px;padding:0 24px;background:#fff;border-bottom:1px solid #dfe5e2">
  <h1 class="h1" style="flex:none">{title}</h1>
  <div class="search" style="width:400px">{icon('i-search','ico-16')}<span style="flex:1">Manzil, telefon yoki tavsif bo'yicha qidirish</span><span class="kbd">/</span></div>
  <div style="flex:1"></div>
  <div class="lang"><span class="on">UZ</span><span>RU</span></div>
  <div class="muted" style="font-size:13px">Shanba, 29-avgust · 14:42</div>
  <a href="#" style="position:relative;color:#3f4d49;display:flex">{icon('i-bell')}<span class="nav-badge" style="position:absolute;top:-8px;right:-10px;min-width:16px;height:16px;font-size:10px">2</span></a>
</header>'''

def wrap(body):
    return f'''<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  {FONTS}
  <style>
{BASE_CSS}
  </style>
</helmet>
{body}
</x-dc>
</body>
</html>
'''

built = []
for f in sorted(SRC.glob('*.screen.html')):
    name = f.name.split('.')[0]
    html = f.read_text()
    html = re.sub(r'<!--NAV:(\w+)-->', lambda m: nav(m.group(1)), html)
    html = re.sub(r'<!--TOPBAR:([^>]*?)-->', lambda m: topbar(m.group(1).strip()), html)
    html = html.replace('<!--ICONS-->', ICONS, 1)
    html = re.sub(r'<!--ICO:([\w-]+)(?::([\w-]+))?-->', lambda m: icon(m.group(1), m.group(2) or 'ico'), html)
    out = OUT / f'{name}.dc.html'
    out.write_text(wrap(html))
    built.append((out.name, len(html)))
for n, size in built:
    print(f'built {n} ({size} chars body)')
