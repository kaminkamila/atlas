import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// ============================================================================
// 1. ПУТИ К ФАЙЛАМ В ПАПКЕ public/
// Проверь, чтобы имена файлов совпадали с твоими в папке public/
// ============================================================================
const DATA_FILES = {
  rivers: '/riv.geojson',       // Файл рек (с полями name_ru, strokeweig, scale_rank)
  roads: '/road.geojson',         // Файл дорог (с полями ROAD_TYPE, CLASS_6M, LABEL, LABEL2, TOLL)
  railroads: '/rail.geojson', // Файл ж/д (с полями featurecla, scalerank, passenger)
  cities: '/cities.geojson',       // Файл городов (с полями name_ru, population, country_iso)
};

// ============================================================================
// 2. ТИПЫ АТРИБУТОВ GEOJSON
// ============================================================================
interface RiverProps {
  OBJECTID: number;
  name?: string;
  name_ru?: string;
  scale_rank?: number;
  strokeweig?: number;
}

interface RoadProps {
  OBJECTID: number;
  CLASS_6M?: string | null;
  ROAD_TYPE?: 'Expressway' | 'Other Highway' | 'Road' | string | null;
  RANK?: number | null;
  SOV_A3?: string | null;
  LEN_KM?: number | null;
  LABEL?: string | null;
  LABEL2?: string | null;
  INT_NET?: string | null;
  TOLL?: number | null;
}

interface RailProps {
  OBJECTID: number;
  featurecla?: 'Railroad' | 'High Speed Rail' | 'Railroad ferry' | string;
  scalerank?: number;
  passenger?: number;
  disp_scale?: string;
}

interface CityProps {
  OBJECTID: number;
  name_ru?: string;
  name_local?: string | null;
  country_iso?: string | null;
  population?: number;
}

type RoadFilterMode = 'all' | 'expressway_only' | 'major';

export default function App() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const osmLayerRef = useRef<L.TileLayer | null>(null);

  // Группы слоёв Leaflet
  const riversGroupRef = useRef<L.LayerGroup | null>(null);
  const railsGroupRef = useRef<L.LayerGroup | null>(null);
  const roadsGroupRef = useRef<L.LayerGroup | null>(null);
  const citiesGroupRef = useRef<L.LayerGroup | null>(null);

  // Загруженные данные GeoJSON
  const [riversData, setRiversData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [roadsData, setRoadsData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [railsData, setRailsData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [citiesData, setCitiesData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);

  // Состояния подложки
  const [showOsm, setShowOsm] = useState<boolean>(true);
  const [osmOpacity, setOsmOpacity] = useState<number>(0.65);

  // Состояния видимости слоёв
  const [showRivers, setShowRivers] = useState<boolean>(true);
  const [showRails, setShowRails] = useState<boolean>(true);
  const [showRoads, setShowRoads] = useState<boolean>(true);
  const [showCities, setShowCities] = useState<boolean>(true);
  const [showCityLabels, setShowCityLabels] = useState<boolean>(true);

  // Фильтры данных
  const [roadFilter, setRoadFilter] = useState<RoadFilterMode>('all');
  const [onlyTurkeyRoads, setOnlyTurkeyRoads] = useState<boolean>(false);
  const [showForeignCities, setShowForeignCities] = useState<boolean>(false);

  // Текущий зум для адаптивной генерализации
  const [zoom, setZoom] = useState<number>(6);

  // Информация о выбранном объекте
  const [selectedInfo, setSelectedInfo] = useState<{
    layer: string;
    title: string;
    details: Record<string, string | number>;
  } | null>(null);

  // ==========================================================================
  // ИНИЦИАЛИЗАЦИЯ КАРТЫ И КАСТОМНЫХ ПЕЙНОВ (Z-INDEX ИЕРАРХИЯ)
  // ==========================================================================
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [39.0, 35.2], // Центр Турции
      zoom: 6,
      minZoom: 4,
      maxZoom: 14,
      zoomControl: false,
      preferCanvas: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

    // Создаём строгую иерархию слоёв (снизу вверх: реки -> ж/д -> дороги -> города)
    map.createPane('riversPane').style.zIndex = '410';
    map.createPane('railsPane').style.zIndex = '420';
    map.createPane('roadsCasingPane').style.zIndex = '430';
    map.createPane('roadsCorePane').style.zIndex = '435';
    map.createPane('citiesPane').style.zIndex = '450';

    // Подложка OpenStreetMap
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      opacity: osmOpacity,
    });
    osmLayer.addTo(map);
    osmLayerRef.current = osmLayer;

    // Инициализируем пустые группы
    riversGroupRef.current = L.layerGroup().addTo(map);
    railsGroupRef.current = L.layerGroup().addTo(map);
    roadsGroupRef.current = L.layerGroup().addTo(map);
    citiesGroupRef.current = L.layerGroup().addTo(map);

    map.on('zoomend', () => {
      setZoom(map.getZoom());
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ==========================================================================
  // УПРАВЛЕНИЕ ПОДЛОЖКОЙ OSM
  // ==========================================================================
  useEffect(() => {
    const map = mapRef.current;
    const osmLayer = osmLayerRef.current;
    if (!map || !osmLayer) return;

    if (showOsm) {
      if (!map.hasLayer(osmLayer)) osmLayer.addTo(map);
      osmLayer.setOpacity(osmOpacity);
    } else {
      if (map.hasLayer(osmLayer)) map.removeLayer(osmLayer);
    }
  }, [showOsm, osmOpacity]);

  // ==========================================================================
  // ЗАГРУЗКА ФАЙЛОВ ИЗ ПАПКИ PUBLIC
  // ==========================================================================
  useEffect(() => {
    async function loadGeoJSON(url: string) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Не удалось загрузить ${url} (${res.status})`);
      return res.json();
    }

    Promise.allSettled([
      loadGeoJSON(DATA_FILES.rivers),
      loadGeoJSON(DATA_FILES.roads),
      loadGeoJSON(DATA_FILES.railroads),
      loadGeoJSON(DATA_FILES.cities),
    ]).then((results) => {
      const errors: string[] = [];

      if (results[0].status === 'fulfilled') setRiversData(results[0].value);
      else errors.push(DATA_FILES.rivers);

      if (results[1].status === 'fulfilled') setRoadsData(results[1].value);
      else errors.push(DATA_FILES.roads);

      if (results[2].status === 'fulfilled') setRailsData(results[2].value);
      else errors.push(DATA_FILES.railroads);

      if (results[3].status === 'fulfilled') setCitiesData(results[3].value);
      else errors.push(DATA_FILES.cities);

      if (errors.length > 0) {
        setLoadingError(`Не найдены файлы в public/: ${errors.join(', ')}. Проверь константу DATA_FILES.`);
      }
    });
  }, []);

  // ==========================================================================
  // ОТРИСОВКА СЛОЯ РЕК
  // ==========================================================================
  useEffect(() => {
    const group = riversGroupRef.current;
    if (!group) return;
    group.clearLayers();

    if (!showRivers || !riversData) return;

    const zoomFactor = Math.max(0.7, (zoom - 4) * 0.45);

    const layer = L.geoJSON(riversData, {
      pane: 'riversPane',
      style: (feature) => {
        const props = (feature?.properties || {}) as RiverProps;
        const baseWeight = props.strokeweig ?? 0.4;
        return {
          color: '#1f78b4',
          weight: Math.max(1.0, baseWeight * 3.0 * zoomFactor),
          opacity: 0.85,
          lineCap: 'round',
          lineJoin: 'round',
        };
      },
      onEachFeature: (feature, lyr) => {
        const props = (feature.properties || {}) as RiverProps;
        const ruName = props.name_ru?.trim() || props.name?.trim() || 'Река без названия';

        lyr.bindTooltip(`р. ${ruName}`, {
          sticky: true,
          direction: 'top',
        });

        lyr.on({
          mouseover: (e) => {
            const target = e.target as L.Path;
            target.setStyle({ color: '#084594', weight: 4, opacity: 1 });
          },
          mouseout: (e) => {
            layer.resetStyle(e.target);
          },
          click: () => {
            setSelectedInfo({
              layer: 'Речная сеть',
              title: ruName,
              details: {
                'Международное название': props.name || '—',
                'Ранг (scale_rank)': props.scale_rank ?? '—',
                'Вес линии (strokeweig)': props.strokeweig ?? '—',
              },
            });
          },
        });
      },
    });

    group.addLayer(layer);
  }, [riversData, showRivers, zoom]);

  // ==========================================================================
  // ОТРИСОВКА СЛОЯ ЖЕЛЕЗНЫХ ДОРОГ (ДВУХСЛОЙНЫЙ СПОСОБ: ОСНОВА + ШПАЛЫ / ВСМ)
  // ==========================================================================
  useEffect(() => {
    const group = railsGroupRef.current;
    if (!group) return;
    group.clearLayers();

    if (!showRails || !railsData) return;

    // 1. Нижний базовый слой линий ж/д
    const baseRailLayer = L.geoJSON(railsData, {
      pane: 'railsPane',
      style: (feature) => {
        const props = (feature?.properties || {}) as RailProps;
        const type = props.featurecla;

        if (type === 'Railroad ferry') {
          return {
            color: '#2b5c8f',
            weight: 2.0,
            dashArray: '5, 6',
            opacity: 0.85,
          };
        }
        if (type === 'High Speed Rail') {
          return {
            color: '#99000d',
            weight: 3.4,
            opacity: 0.95,
          };
        }
        return {
          color: '#252525',
          weight: 2.6,
          opacity: 0.9,
        };
      },
      onEachFeature: (feature, lyr) => {
        const props = (feature.properties || {}) as RailProps;
        const typeLabel =
          props.featurecla === 'High Speed Rail'
            ? 'Высокоскоростная магистраль (YHT)'
            : props.featurecla === 'Railroad ferry'
              ? 'Железнодорожный паром'
              : 'Железная дорога';

        lyr.bindTooltip(typeLabel, { sticky: true });
        lyr.on('click', () => {
          setSelectedInfo({
            layer: 'Железные дороги',
            title: typeLabel,
            details: {
              'Тип (featurecla)': props.featurecla || '—',
              'Пассажирское движение': props.passenger === 1 ? 'Да' : 'Нет',
              'Ранг (scalerank)': props.scalerank ?? '—',
              'Масштаб отображения': props.disp_scale || '—',
            },
          });
        });
      },
    });

    // 2. Верхний штриховой слой («шпалы») для обычных и высокоскоростных ж/д
    const tiesRailLayer = L.geoJSON(railsData, {
      pane: 'railsPane',
      filter: (feature) => {
        const props = (feature?.properties || {}) as RailProps;
        return props.featurecla !== 'Railroad ferry';
      },
      style: (feature) => {
        const props = (feature?.properties || {}) as RailProps;
        if (props.featurecla === 'High Speed Rail') {
          return {
            color: '#ffeda0',
            weight: 1.6,
            dashArray: '6, 6',
            opacity: 0.95,
            interactive: false,
          };
        }
        return {
          color: '#ffffff',
          weight: 1.4,
          dashArray: '4, 5',
          opacity: 0.95,
          interactive: false,
        };
      },
    });

    group.addLayer(baseRailLayer);
    group.addLayer(tiesRailLayer);
  }, [railsData, showRails]);

  // ==========================================================================
  // ОТРИСОВКА АВТОМАГИСТРАЛЕЙ И ДОРОГ (CASING + ВНУТРЕННЯЯ ЛИНИЯ)
  // ==========================================================================
  useEffect(() => {
    const group = roadsGroupRef.current;
    if (!group) return;
    group.clearLayers();

    if (!showRoads || !roadsData) return;

    const filterFn = (feature: GeoJSON.Feature) => {
      const props = (feature.properties || {}) as RoadProps;
      if (onlyTurkeyRoads && props.SOV_A3 && props.SOV_A3 !== 'TUR') {
        return false;
      }
      if (roadFilter === 'expressway_only') {
        return props.ROAD_TYPE === 'Expressway' || props.CLASS_6M === 'M';
      }
      if (roadFilter === 'major') {
        return (
          props.ROAD_TYPE === 'Expressway' ||
          props.ROAD_TYPE === 'Other Highway' ||
          props.CLASS_6M === 'M' ||
          props.CLASS_6M === 'H'
        );
      }
      return true;
    };

    // 1. Внешняя обводка (Casing) для читаемости поверх любой подложки
    const casingLayer = L.geoJSON(roadsData, {
      pane: 'roadsCasingPane',
      filter: filterFn,
      style: (feature) => {
        const props = (feature?.properties || {}) as RoadProps;
        const isExpressway = props.ROAD_TYPE === 'Expressway' || props.CLASS_6M === 'M';
        const isHighway = props.ROAD_TYPE === 'Other Highway' || props.CLASS_6M === 'H';

        return {
          color: isExpressway ? '#7f2704' : isHighway ? '#8c510a' : '#636363',
          weight: isExpressway ? 4.8 : isHighway ? 3.4 : 2.2,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        };
      },
    });

    // 2. Внутренняя цветная линия + интерактивность
    const coreLayer = L.geoJSON(roadsData, {
      pane: 'roadsCorePane',
      filter: filterFn,
      style: (feature) => {
        const props = (feature?.properties || {}) as RoadProps;
        const isExpressway = props.ROAD_TYPE === 'Expressway' || props.CLASS_6M === 'M';
        const isHighway = props.ROAD_TYPE === 'Other Highway' || props.CLASS_6M === 'H';

        return {
          color: isExpressway ? '#ff7f00' : isHighway ? '#fdb863' : '#e0e0e0',
          weight: isExpressway ? 2.8 : isHighway ? 1.8 : 1.0,
          opacity: 1,
          lineCap: 'round',
          lineJoin: 'round',
        };
      },
      onEachFeature: (feature, lyr) => {
        const props = (feature.properties || {}) as RoadProps;
        const label1 = props.LABEL?.trim() || '';
        const label2 = props.LABEL2?.trim() || '';
        const routeCode = [label1, label2].filter(Boolean).join(' / ') || 'Без индекса';

        const typeRu =
          props.ROAD_TYPE === 'Expressway'
            ? 'Автомагистраль (Otoyol)'
            : props.ROAD_TYPE === 'Other Highway'
              ? 'Государственное шоссе'
              : 'Дорога регионального значения';

        lyr.bindTooltip(`${typeRu}: <b>${routeCode}</b>`, { sticky: true });

        lyr.on({
          mouseover: (e) => {
            const target = e.target as L.Path;
            target.setStyle({ color: '#ffff33', weight: 4 });
          },
          mouseout: (e) => {
            coreLayer.resetStyle(e.target);
          },
          click: () => {
            setSelectedInfo({
              layer: 'Автодорожная сеть',
              title: `${typeRu} (${routeCode})`,
              details: {
                'Национальный индекс (LABEL)': label1 || '—',
                'Европейский маршрут (LABEL2)': label2 || '—',
                'Категория (ROAD_TYPE)': props.ROAD_TYPE || 'Прочая',
                'Платный участок (TOLL)': props.TOLL === 1 ? 'Да (платная)' : 'Нет',
                'Протяжённость сегмента': props.LEN_KM ? `${props.LEN_KM} км` : '—',
                'Страна (SOV_A3)': props.SOV_A3 || 'TUR',
              },
            });
          },
        });
      },
    });

    group.addLayer(casingLayer);
    group.addLayer(coreLayer);
  }, [roadsData, showRoads, roadFilter, onlyTurkeyRoads]);

  // ==========================================================================
  // ОТРИСОВКА ГОРОДОВ (ПУНСОНЫ ПО ЛЮДНОСТИ + ПОДПИСИ)
  // ==========================================================================
  useEffect(() => {
    const group = citiesGroupRef.current;
    if (!group) return;
    group.clearLayers();

    if (!showCities || !citiesData) return;

    // Ступенчатая шкала радиуса пунсона по населению
    const getCityRadius = (pop: number) => {
      if (pop >= 10_000_000) return 9.5; // Стамбул
      if (pop >= 2_000_000) return 7.5;  // Анкара, Бурса, Измир, Газиантеп...
      if (pop >= 1_000_000) return 6.0;  // Адана, Конья, Анталия, Кайсери...
      if (pop >= 500_000) return 5.0;    // Эскишехир, Эрзурум, Малатья, Мерсин, Ван...
      if (pop >= 250_000) return 4.2;    // Трабзон, Самсун, Денизли, Сивас...
      return 3.4;                        // Менее 250 тыс.
    };

    const layer = L.geoJSON(citiesData, {
      pane: 'citiesPane',
      filter: (feature) => {
        const props = (feature.properties || {}) as CityProps;
        // В файле у Айдына country_iso === null, поэтому считаем и 'TR', и null городами Турции
        const isTurkish = props.country_iso === 'TR' || props.country_iso === null;
        return showForeignCities ? true : isTurkish;
      },
      pointToLayer: (feature, latlng) => {
        const props = (feature.properties || {}) as CityProps;
        const pop = props.population || 0;
        const isTurkish = props.country_iso === 'TR' || props.country_iso === null;
        const isCapital = props.name_ru === 'Анкара';

        const marker = L.circleMarker(latlng, {
          pane: 'citiesPane',
          radius: getCityRadius(pop),
          fillColor: isCapital ? '#e31a1c' : isTurkish ? '#ffffff' : '#d9d9d9',
          color: isCapital ? '#800026' : isTurkish ? '#1a1a1a' : '#666666',
          weight: isCapital ? 2.5 : 1.8,
          fillOpacity: 0.95,
        });

        const nameRu = props.name_ru || props.name_local || 'Город';

        if (showCityLabels) {
          marker.bindTooltip(nameRu, {
            permanent: true,
            direction: 'right',
            offset: [6, 0],
            className: isCapital
              ? 'city-label city-label-capital'
              : isTurkish
                ? 'city-label'
                : 'city-label city-label-foreign',
          });
        } else {
          marker.bindTooltip(`${nameRu} (${pop.toLocaleString('ru-RU')} чел.)`, {
            direction: 'top',
          });
        }

        marker.on('click', () => {
          setSelectedInfo({
            layer: 'Населённые пункты',
            title: nameRu,
            details: {
              'Местное название': props.name_local || '—',
              'Численность населения': `${pop.toLocaleString('ru-RU')} чел.`,
              'Код страны': props.country_iso || 'TR',
            },
          });
        });

        return marker;
      },
    });

    group.addLayer(layer);
  }, [citiesData, showCities, showCityLabels, showForeignCities]);

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      {/* Стили для подписей городов */}
      <style>{`
        .city-label {
          background: rgba(255, 255, 255, 0.82);
          border: 1px solid rgba(0, 0, 0, 0.2);
          border-radius: 3px;
          padding: 1px 4px;
          font-size: 11px;
          font-weight: 600;
          color: #1f2937;
          box-shadow: 0 1px 2px rgba(0,0,0,0.1);
          pointer-events: none;
        }
        .city-label::before {
          display: none;
        }
        .city-label-capital {
          background: #fee2e2;
          border-color: #ef4444;
          color: #991b1b;
          font-size: 12px;
          font-weight: 700;
        }
        .city-label-foreign {
          background: rgba(243, 244, 246, 0.75);
          color: #6b7280;
          font-weight: 500;
        }
      `}</style>

      {/* БОКОВАЯ ПАНЕЛЬ УПРАВЛЕНИЯ СЛОЯМИ */}
      <aside
        style={{
          width: '330px',
          minWidth: '330px',
          backgroundColor: '#ffffff',
          borderRight: '1px solid #e5e7eb',
          padding: '16px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          zIndex: 1000,
        }}
      >
        <div>
          <h2 style={{ margin: '0 0 4px 0', fontSize: '18px', color: '#111827' }}>
            Картографическая основа
          </h2>
          <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>
            Гидрография, транспортная сеть и города
          </p>
        </div>

        {loadingError && (
          <div
            style={{
              padding: '10px',
              backgroundColor: '#fef2f2',
              border: '1px solid #f87171',
              borderRadius: '6px',
              fontSize: '12px',
              color: '#991b1b',
            }}
          >
            {loadingError}
          </div>
        )}

        {/* Блок 1: Подложка OSM */}
        <section style={{ borderTop: '1px solid #e5e7eb', paddingTop: '12px' }}>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '8px', color: '#374151' }}>
            Базовая подложка
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showOsm}
              onChange={(e) => setShowOsm(e.target.checked)}
            />
            Подложка OpenStreetMap
          </label>
          {showOsm && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#4b5563' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>Непрозрачность OSM:</span>
                <span>{Math.round(osmOpacity * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={osmOpacity}
                onChange={(e) => setOsmOpacity(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
          )}
        </section>

        {/* Блок 2: Тематические и общегеографические слои */}
        <section style={{ borderTop: '1px solid #e5e7eb', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontWeight: 600, fontSize: '13px', color: '#374151' }}>
            Векторные слои (public/)
          </div>

          {/* Реки */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showRivers}
              onChange={(e) => setShowRivers(e.target.checked)}
            />
            <span>Речная сеть ({riversData?.features.length ?? 0})</span>
          </label>

          {/* Железные дороги */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showRails}
              onChange={(e) => setShowRails(e.target.checked)}
            />
            <span>Железные дороги ({railsData?.features.length ?? 0})</span>
          </label>

          {/* Автодороги */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showRoads}
                onChange={(e) => setShowRoads(e.target.checked)}
              />
              <span>Автомагистрали и дороги ({roadsData?.features.length ?? 0})</span>
            </label>

            {showRoads && (
              <div style={{ marginLeft: '22px', marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <select
                  value={roadFilter}
                  onChange={(e) => setRoadFilter(e.target.value as RoadFilterMode)}
                  style={{
                    padding: '4px 6px',
                    fontSize: '12px',
                    borderRadius: '4px',
                    border: '1px solid #d1d5db',
                  }}
                >
                  <option value="all">Все категории дорог</option>
                  <option value="major">Магистрали и главные шоссе</option>
                  <option value="expressway_only">Только автомагистрали (Otoyol)</option>
                </select>

                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#4b5563', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={onlyTurkeyRoads}
                    onChange={(e) => setOnlyTurkeyRoads(e.target.checked)}
                  />
                  Только территория Турции (TUR)
                </label>
              </div>
            )}
          </div>

          {/* Города */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showCities}
                onChange={(e) => setShowCities(e.target.checked)}
              />
              <span>Города ({citiesData?.features.length ?? 0})</span>
            </label>

            {showCities && (
              <div style={{ marginLeft: '22px', marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#4b5563', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showCityLabels}
                    onChange={(e) => setShowCityLabels(e.target.checked)}
                  />
                  Постоянные подписи городов
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#4b5563', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showForeignCities}
                    onChange={(e) => setShowForeignCities(e.target.checked)}
                  />
                  Показывать зарубежные города
                </label>
              </div>
            )}
          </div>
        </section>

        {/* Блок 3: Легенда */}
        <section style={{ borderTop: '1px solid #e5e7eb', paddingTop: '12px', fontSize: '12px', color: '#374151' }}>
          <div style={{ fontWeight: 600, marginBottom: '8px' }}>Условные обозначения</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '22px', height: '4px', background: '#ff7f00', border: '1px solid #7f2704', display: 'inline-block' }} />
              <span>Автомагистрали (Expressway)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '22px', height: '3px', background: '#fdb863', border: '1px solid #8c510a', display: 'inline-block' }} />
              <span>Государственные шоссе (Highway)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '22px', height: '3px', background: '#99000d', display: 'inline-block' }} />
              <span>Высокоскоростные ж/д (ВСМ)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '22px', height: '3px', background: '#252525', borderTop: '1px dashed #fff', display: 'inline-block' }} />
              <span>Железные дороги и ж/д паром</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '22px', height: '2.5px', background: '#1f78b4', display: 'inline-block' }} />
              <span>Реки (по градации водотока)</span>
            </div>
          </div>
        </section>

        {/* Блок 4: Карточка выбранного объекта */}
        {selectedInfo && (
          <section
            style={{
              marginTop: 'auto',
              padding: '12px',
              backgroundColor: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              fontSize: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                {selectedInfo.layer}
              </span>
              <button
                onClick={() => setSelectedInfo(null)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '14px', color: '#64748b' }}
              >
                ✕
              </button>
            </div>
            <div style={{ fontWeight: 700, fontSize: '14px', margin: '4px 0 8px 0', color: '#0f172a' }}>
              {selectedInfo.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {Object.entries(selectedInfo.details).map(([key, val]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <span style={{ color: '#475569' }}>{key}:</span>
                  <span style={{ fontWeight: 600, color: '#0f172a', textAlign: 'right' }}>{val}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </aside>

      {/* КОНТЕЙНЕР КАРТЫ */}
      <main style={{ flex: 1, position: 'relative' }}>
        <div
          ref={mapContainerRef}
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: showOsm ? '#e5e7eb' : '#f4f1ea',
          }}
        />
      </main>
    </div>
  );
}