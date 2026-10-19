// src/App.tsx
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

// 1. Импортируем всё пространство имен
import * as maplibregl from 'maplibre-gl';
import type {
  Map as MapLibreMap,
  MapLayerMouseEvent,
  StyleSpecification,
} from 'maplibre-gl';

// 2. Импортируем URL воркера с помощью специального синтаксиса Vite
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// 3. Указываем MapLibre, где находится воркер (до создания карты!)
maplibregl.setWorkerUrl(maplibreWorkerUrl);

import 'maplibre-gl/dist/maplibre-gl.css';

// Рекомендуется положить файл в папку public, чтобы Vite корректно отдал его по абсолютном пути
const GEOJSON_URL = 'src/osnova.geojson';

const MIN_ZOOM = 2;
const MAX_ZOOM = 14;

const EMPTY_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {},
  layers: [],
};

type Status = 'loading' | 'ready' | 'error';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [basemapVisible, setBasemapVisible] = useState(true);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: EMPTY_STYLE,
      center: [37, 39],
      zoom: 8,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      'top-right',
    );
    map.addControl(
      new maplibregl.ScaleControl({ maxWidth: 160, unit: 'metric' }),
      'bottom-left',
    );
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: '© OpenStreetMap © CARTO · Natural Earth',
      }),
      'bottom-right',
    );

    map.on('load', async () => {
      try {
        addWorldBasemap(map);

        const res = await fetch(GEOJSON_URL);
        if (!res.ok) {
          throw new Error(`Не удалось загрузить ${GEOJSON_URL}: ${res.status}`);
        }
        const geojson = (await res.json()) as GeoJSON.FeatureCollection;

        addOsnova(map, geojson);
        attachInteractions(map);

        const bounds = computeBounds(geojson);
        if (bounds) {
          map.fitBounds(bounds, { padding: 60, animate: false });
          map.setMaxBounds(padBounds(bounds, 1.5));
        }

        setStatus('ready');
      } catch (err) {
        console.error(err);
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    });

    map.on('error', (e) => {
      console.warn('[maplibre]', e.error?.message ?? e);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /* Показать/скрыть растровую подложку */
  const toggleBasemap = () => {
    const map = mapRef.current;
    if (!map || !map.getLayer('world')) return;

    const next = !basemapVisible;
    map.setLayoutProperty('world', 'visibility', next ? 'visible' : 'none');
    setBasemapVisible(next);
  };

  return (
    <div style={styles.root}>
      <div ref={containerRef} style={styles.map} />

      {status === 'loading' && <div style={styles.toast}>Загрузка карты…</div>}
      {status === 'error' && (
        <div style={{ ...styles.toast, color: 'crimson' }}>
          Ошибка: {errorMsg}
        </div>
      )}

      {status === 'ready' && (
        <>
          <button
            type="button"
            onClick={toggleBasemap}
            style={{
              ...styles.toggleBtn,
              background: basemapVisible ? '#1f6feb' : '#ffffff',
              color: basemapVisible ? '#ffffff' : '#1f2937',
              borderColor: basemapVisible ? '#1f6feb' : '#cbd5e1',
            }}
            title={basemapVisible ? 'Скрыть подложку' : 'Показать подложку'}
          >
            {basemapVisible ? 'Подложка: вкл' : 'Подложка: выкл'}
          </button>

          <div style={styles.legend}>
            <div style={styles.legendTitle}>Условные обозначения</div>
            <LegendRow color="#FFFACD" label="Территория" />
            <LegendRow color="#1a1a1a" label="Города" round />
            <LegendRow color="#8B4513" label="Горы" round />
            <LegendRow color="#3d6db3" label="Впадины" round />
            <LegendRow color="#444444" label="Границы" />
            <LegendRow color="#e67e22" label="Дороги" />
            <LegendRow color="#2b2b2b" label="Железные дороги" dashed />
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Растровая подложка мира                                            */
/* ------------------------------------------------------------------ */

function addWorldBasemap(map: MapLibreMap) {
  if (map.getSource('world')) return;

  map.addSource('world', {
    type: 'raster',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    tileSize: 256,
    attribution: '© OpenStreetMap contributors',
  });

  map.addLayer({
    id: 'world',
    type: 'raster',
    source: 'world',
    layout: { visibility: 'visible' },
    paint: {
      'raster-opacity': 1,
      'raster-fade-duration': 0,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Слои данных                                                        */
/* ------------------------------------------------------------------ */

function addOsnova(map: MapLibreMap, data: GeoJSON.FeatureCollection) {
  map.addSource('osnova', {
    type: 'geojson',
    data,
    generateId: true,
  });

  map.addLayer({
    id: 'osnova-polygons',
    type: 'fill',
    source: 'osnova',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: {
      'fill-color': '#FFFACD',
      'fill-opacity': 0.75,
    },
  });
  map.addLayer({
    id: 'osnova-polygons-outline',
    type: 'line',
    source: 'osnova',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: {
      'line-color': '#7ba7c7',
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 8, 2.5],
    },
  });

  map.addLayer({
    id: 'osnova-railroads',
    type: 'line',
    source: 'osnova',
    filter: ['==', ['get', 'featurecla'], 'Railroad'],
    paint: {
      'line-color': '#2b2b2b',
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.2, 8, 2.6],
      'line-dasharray': [3, 2],
      'line-opacity': 0.9,
    },
  });

  map.addLayer({
    id: 'osnova-roads',
    type: 'line',
    source: 'osnova',
    filter: ['has', 'ROAD_TYPE'],
    paint: {
      'line-color': [
        'case',
        ['==', ['get', 'ROAD_TYPE'], 'Expressway'],
        '#e67e22',
        ['==', ['get', 'ROAD_TYPE'], 'Other Highway'],
        '#f0a050',
        '#cccccc',
      ],
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 6, 1.8, 8, 3.2],
      'line-opacity': 0.95,
    },
  });

  map.addLayer({
    id: 'osnova-boundaries',
    type: 'line',
    source: 'osnova',
    filter: ['==', ['get', 'STATUS'], 'International Boundary'],
    paint: {
      'line-color': '#444',
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.6, 8, 3.2],
      'line-opacity': 0.95,
    },
  });

  map.addLayer({
    id: 'osnova-mountains',
    type: 'circle',
    source: 'osnova',
    filter: ['all', ['has', 'elevation'], ['!=', ['get', 'elevation'], null]],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4.5, 8, 8],
      'circle-color': [
        'case',
        ['<', ['get', 'elevation'], 0],
        '#3d6db3',
        '#8B4513',
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  });

  map.addLayer({
    id: 'osnova-cities',
    type: 'circle',
    source: 'osnova',
    filter: ['has', 'population'],
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['get', 'population'],
        100_000, 10,
        500_000, 15,
        1_000_000, 20,
        5_000_000, 30,
        15_000_000, 50,
      ],
      'circle-color': '#1a1a1a',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2.2,
    },
  });

  map.addLayer({
    id: 'osnova-cities-labels',
    type: 'symbol',
    source: 'osnova',
    filter: ['has', 'population'],
    minzoom: 3,
    layout: {
      'text-field': ['coalesce', ['get', 'name_ru'], ['get', 'name_local']],
      'text-font': ['Noto Sans Regular'],
      'text-size': [
        'interpolate',
        ['linear'],
        ['get', 'population'],
        100_000, 20,
        1_000_000, 30,
        15_000_000, 50,
      ],
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-optional': true,
    },
    paint: {
      'text-color': '#111',
      'text-halo-color': '#ffffff',
      'text-halo-width': 2,
    },
  });

  map.addLayer({
    id: 'osnova-mountains-labels',
    type: 'symbol',
    source: 'osnova',
    filter: [
      'all',
      ['has', 'elevation'],
      ['!=', ['get', 'name_ru'], ' '],
      ['!=', ['get', 'name_ru'], null],
    ],
    minzoom: 5,
    layout: {
      'text-field': [
        'concat',
        ['coalesce', ['get', 'name_ru'], ['get', 'name_en'], ''],
        ' ',
        ['to-string', ['get', 'elevation']],
        ' м',
      ],
      'text-font': ['Noto Sans Regular'],
      'text-size': 14,
      'text-offset': [0, 1.3],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: {
      'text-color': '#5a2d0c',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.8,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Ховер-попапы                                                       */
/* ------------------------------------------------------------------ */

function attachInteractions(map: MapLibreMap) {
  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 14,
    maxWidth: '320px',
  });

  const showCity = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties as Record<string, unknown>;
    map.getCanvas().style.cursor = 'pointer';

    popup
      .setLngLat(e.lngLat)
      .setHTML(
        `<div style="font-family:system-ui;font-size:16px;line-height:1.5">
           <strong>${escapeHtml(String(p.name_ru ?? p.name_local ?? '—'))}</strong><br/>
           <span style="color:#666">${escapeHtml(String(p.name_local ?? ''))}</span><br/>
           <span>Население: <b>${formatNumber(p.population)}</b></span><br/>
           <span style="color:#888">${escapeHtml(String(p.country_iso ?? ''))}</span>
         </div>`,
      )
      .addTo(map);
  };

  const showFeature = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties as Record<string, unknown>;
    map.getCanvas().style.cursor = 'pointer';

    const rows: string[] = [];
    if (p.name_ru && p.name_ru !== ' ') {
      rows.push(`<strong>${escapeHtml(String(p.name_ru))}</strong>`);
    }
    if (typeof p.elevation === 'number') rows.push(`Высота: ${p.elevation} м`);
    if (p.ROAD_TYPE) rows.push(`Тип: ${escapeHtml(String(p.ROAD_TYPE))}`);
    if (p.LABEL && p.LABEL !== ' ') rows.push(`Метка: ${escapeHtml(String(p.LABEL))}`);
    if (p.STATUS) rows.push(escapeHtml(String(p.STATUS)));
    if (p.COUNTRY1 && p.COUNTRY2) {
      rows.push(`${escapeHtml(String(p.COUNTRY1))} ↔ ${escapeHtml(String(p.COUNTRY2))}`);
    }

    popup
      .setLngLat(e.lngLat)
      .setHTML(
        `<div style="font-family:system-ui;font-size:16px;line-height:1.5">
           ${rows.join('<br/>') || '<em>Объект</em>'}
         </div>`,
      )
      .addTo(map);
  };

  const hide = () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  };

  map.on('mousemove', 'osnova-cities', showCity);
  map.on('mouseleave', 'osnova-cities', hide);

  for (const layer of [
    'osnova-mountains',
    'osnova-roads',
    'osnova-boundaries',
    'osnova-railroads',
  ]) {
    map.on('mousemove', layer, showFeature);
    map.on('mouseleave', layer, hide);
  }
}

/* ------------------------------------------------------------------ */
/* Утилиты геометрии                                                  */
/* ------------------------------------------------------------------ */

function computeBounds(
  fc: GeoJSON.FeatureCollection,
): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (
      coords.length >= 2 &&
      typeof coords[0] === 'number' &&
      typeof coords[1] === 'number'
    ) {
      const x = coords[0];
      const y = coords[1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    for (const c of coords) walk(c);
  };

  for (const f of fc.features) {
    if (!f.geometry) continue;
    walk((f.geometry as { coordinates?: unknown }).coordinates);
  }

  if (!Number.isFinite(minX)) return null;
  return [[minX, minY], [maxX, maxY]];
}

function padBounds(
  b: [[number, number], [number, number]],
  factor: number,
): [[number, number], [number, number]] {
  const [[minX, minY], [maxX, maxY]] = b;
  const dx = (maxX - minX) * factor;
  const dy = (maxY - minY) * factor;
  return [[minX - dx, minY - dy], [maxX + dx, maxY + dy]];
}

/* ------------------------------------------------------------------ */
/* Утилиты                                                            */
/* ------------------------------------------------------------------ */

function formatNumber(n: unknown): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—';
  return n.toLocaleString('ru-RU');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}

/* ------------------------------------------------------------------ */
/* Легенда                                                            */
/* ------------------------------------------------------------------ */

function LegendRow({
  color,
  label,
  dashed,
  round,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  round?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        marginTop: 14,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: round ? 26 : 44,
          height: round ? 26 : 18,
          borderRadius: round ? '50%' : 4,
          background: dashed
            ? `repeating-linear-gradient(90deg, ${color} 0 10px, transparent 10px 16px)`
            : color,
          border: round ? '3px solid #fff' : 'none',
          boxShadow: round ? '0 0 0 2px rgba(0,0,0,0.2)' : 'none',
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 22, color: '#222', lineHeight: 1.2 }}>
        {label}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Стили                                                              */
/* ------------------------------------------------------------------ */

const styles: Record<string, CSSProperties> = {
  root: { position: 'relative', width: '100%', height: '100vh' },
  map: { position: 'absolute', inset: 0 },
  toast: {
    position: 'absolute',
    top: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '12px 24px',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.95)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    fontSize: 18,
    zIndex: 10,
  },
  toggleBtn: {
    position: 'absolute',
    top: 110,
    right: 12,
    zIndex: 10,
    padding: '10px 16px',
    fontSize: 16,
    fontWeight: 600,
    borderRadius: 8,
    border: '2px solid #cbd5e1',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
    fontFamily: 'system-ui, sans-serif',
  },
  legend: {
    position: 'absolute',
    bottom: 40,
    left: 40,
    padding: '28px 34px',
    borderRadius: 16,
    background: 'rgba(255,255,257,0.97)',
    boxShadow: '0 10px 32px rgba(0,0,0,0.22)',
    zIndex: 10,
    minWidth: 380,
  },
  legendTitle: {
    fontSize: 22,
    fontWeight: 800,
    marginBottom: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#111',
    borderBottom: '2px solid #e0e0e0',
    paddingBottom: 12,
  },
};